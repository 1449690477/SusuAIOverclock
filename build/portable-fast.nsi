# ============================================================================
#  苏苏 AI超频 · 加速版 portable 启动器
#  ---------------------------------------------------------------------------
#  为什么需要改这个模板
#  ---------------------------------------------------------------------------
#  electron-builder 原生 portable.nsi 每次双击都做完整的三段 I/O：
#      1) Nsis7z::Extract 把 app-64.7z 解压到 $PLUGINSDIR\7z-out
#      2) CopyFiles 把 7z-out 全量复制到 $INSTDIR
#      3) 进程退出后 RMDir /r 把整个目录删掉
#  本机 NVMe 实测（678MB 解压后 / 5279 文件）：
#      7z 解压     0.9s → 5.8s
#      CopyFiles   5.8s → 21.1s   <-- 瓶颈：5279 个小文件逐个复制 + 杀软实时扫描
#      删除暂存    21.1s → 21.9s
#      合计 ~22s 之后才轮到 Electron 启动（Electron 自身实测仅 636ms）
#
#  优化策略（三级降级，越往后越稳）
#  ---------------------------------------------------------------------------
#      L1 缓存命中     → 直接启动缓存目录，零解压，约 0.6s 出窗口
#      L2 缓存缺失/损坏 → 7z 解压进唯一暂存目录（跳过 CopyFiles 中转），
#                        校验关键文件后原子改名为正式缓存，再写完成标记
#      L3 缓存不可写   → 回退原生 $PLUGINSDIR 行为（每次解压，但功能不受影响）
#
#  缓存位置：%LOCALAPPDATA%\SusuAIOverclock-cache\<VERSION>\
#  失效条件：主 exe / 完成标记 / ffmpeg.dll / icudtl.dat 任一缺失
#  清理方式：删除该目录即可，下次启动会重新解压
#
#  v1.3.1 加固（修复「找不到 ffmpeg.dll」事故）：
#  旧版 L2 直接解压进缓存目录，并发双击时第二个实例会 RMDir 掉第一个正在
#  解压的目录，且 Nsis7z::Extract 吞写入错误，半截缓存照样写标记 →
#  之后 L1 永久命中半截缓存，每次启动报「找不到 ffmpeg.dll」。
#  新版：解压进 <版本>.tmp-<PID> 暂存 → 四关键文件校验 → Rename 原子晋升
#  → 晋升成功才写标记；并发实例先改名者赢，后来者等标记直接复用。
# ============================================================================

!include "common.nsh"
!include "extractAppPackage.nsh"
!include "LogicLib.nsh"

CRCCheck off
WindowIcon Off
AutoCloseWindow True
RequestExecutionLevel ${REQUEST_EXECUTION_LEVEL}

Var /GLOBAL cacheDir
Var /GLOBAL cacheParent
Var /GLOBAL cacheMarker
Var /GLOBAL cacheState
Var /GLOBAL traceOn
Var /GLOBAL waitCount
Var /GLOBAL stageRoot

Function .onInit
  !ifndef SPLASH_IMAGE
    SetSilent silent
  !endif

  !insertmacro check64BitAndSetRegView
FunctionEnd

Function .onGUIInit
  InitPluginsDir

  !ifdef SPLASH_IMAGE
    File /oname=$PLUGINSDIR\splash.bmp "${SPLASH_IMAGE}"
    BgImage::SetBg $PLUGINSDIR\splash.bmp
    BgImage::Redraw
  !endif
FunctionEnd

Section
  !ifdef SPLASH_IMAGE
    HideWindow
  !endif

  StrCpy $cacheState "miss"

  # ---------- 计算缓存目录（固定 ASCII 名，避开中文路径坑）----------
  ReadEnvStr $cacheDir "LOCALAPPDATA"
  ${If} $cacheDir == ""
    StrCpy $cacheDir "$TEMP"
  ${EndIf}
  # 父目录单独存一份：L2 暂存目录与原子晋升都挂在父目录下
  StrCpy $cacheParent "$cacheDir\SusuAIOverclock-cache"
  StrCpy $cacheDir "$cacheParent\${VERSION}"
  StrCpy $cacheMarker "$cacheDir\.cache-complete"

  # ---------- L1: 缓存命中判定 ----------
   IfFileExists "$cacheDir\${APP_EXECUTABLE_FILENAME}" 0 try_extract
   IfFileExists "$cacheMarker" 0 try_extract
   # 关键文件抽验：ffmpeg.dll 缺失说明缓存半截（v1.3.0 事故：并发双击互踩解压，
   # 旧版只验 exe+marker，半截缓存永久命中，每次启动报「找不到 ffmpeg.dll」）。
   # marker 缺失/关键文件缺失都走 try_extract 重建，不信任半截目录。
   IfFileExists "$cacheDir\ffmpeg.dll" 0 try_extract
   IfFileExists "$cacheDir\icudtl.dat" 0 try_extract
   StrCpy $INSTDIR "$cacheDir"
   # 命中缓存时也显式切换 CWD；Electron/Chromium 的相对路径解析不能依赖
   # 启动器当前目录（双击和命令行启动的 CWD 不一致）。SetOutPath 这里只
   # 设置工作目录，不会复制任何文件。
   SetOutPath "$INSTDIR"
   StrCpy $cacheState "hit"
   Goto launch

  # ---------- L2: 解压到缓存目录（v1.3.1 重写：短名暂存 + 校验 + 原子晋升）----------
  # 旧逻辑两个致命伤（v1.3.0 事故根因，用户双击报「找不到 ffmpeg.dll」）：
  #   1) 并发双击互踩：第二个实例 RMDir 掉第一个正在解压的目录，
  #      半截缓存 + marker 照写 → 之后每次 L1 命中半截缓存，永远报错
  #   2) Nsis7z::Extract 吞写入错误（electron-builder 上游 issue #6547 同款），
  #      失败也照样写 marker、照样启动半截 Electron
  # 新逻辑：解压进短名暂存根「%LOCALAPPDATA%\SOCstg\<PID>」→ 校验关键文件
  #（exe/ffmpeg.dll/icudtl.dat/app.asar）→ 全过才原子 Rename 晋升为正式缓存。
  # 并发实例各解压各的暂存目录，先改名者成为缓存，后来者等待 marker 直接复用。
  # 为什么暂存用短名独立根、不挂在 SusuAIOverclock-cache\<版本>.tmp-<PID> 下：
  #   暂存完整路径每多一个字符，最深层文件路径就跟着多一个字符。本项目 skill 树
  #   里有相对路径已达 ~198 字符的深层文件（competition-request-normalization-
  #   smuggling/references/*.md）。tmp-<PID> 长名会把它们顶过 Nsis7z 解压缓冲上限
  #   被静默跳过（v1.3.1 实测：2 个深层文件解压丢失，缓存比源少 2 个）。SOCstg\<PID>
  #   短名根把最深解压路径压到 ~248，低于 1.3.0 已证明可写的 261，全部文件可靠落地。
  #   暂存根与正式缓存同在 %LOCALAPPDATA% 同卷，Rename 跨同卷原子移动成立。
  try_extract:
    # Rename 目标父目录（正式缓存根）：必须可建可写，否则晋升无意义，直接 fallback
    StrCpy $R1 "$cacheParent"
    ClearErrors
    CreateDirectory "$R1"
    IfErrors fallback
    FileOpen $0 "$R1\.probe" w
    IfErrors fallback
    FileClose $0
    Delete "$R1\.probe"

    # 暂存根：短名独立目录（与正式缓存同卷）
    ReadEnvStr $stageRoot "LOCALAPPDATA"
    ${If} $stageRoot == ""
      StrCpy $stageRoot "$TEMP"
    ${EndIf}
    StrCpy $stageRoot "$stageRoot\SOCstg"
    ClearErrors
    CreateDirectory "$stageRoot"
    IfErrors fallback

    System::Call 'Kernel32::GetCurrentProcessId()i.r2'
    StrCpy $R2 "$stageRoot\$2"
    # 清掉上次崩溃残留的同名暂存（PID 复用概率极低，代价可控）
    ClearErrors
    RMDir /r "$R2"
    ClearErrors
    CreateDirectory "$R2"
    IfErrors fallback
    StrCpy $INSTDIR "$R2"
    StrCpy $cacheState "staging"
    Goto do_extract

  # ---------- L3: 缓存不可写，回退原生行为 ----------
  fallback:
    StrCpy $INSTDIR "$PLUGINSDIR\app"
    RMDir /r $INSTDIR
    StrCpy $cacheState "miss"

  # ---------- 唯一的文件落地代码（宏只能插入一次，运行时可 goto 重入）----------
  do_extract:
    SetOutPath "$INSTDIR"

    !ifdef APP_64
      !ifndef APP_32
        !ifndef APP_ARM64
          # ---- 单一 x64 包：直接 7z 解压进目标目录，省掉 CopyFiles 中转 ----
          !ifdef ZIP_COMPRESSION
            File /oname=$PLUGINSDIR\app-64.zip "${APP_64}"
            nsisunz::Unzip "$PLUGINSDIR\app-64.zip" "$INSTDIR"
            Pop $0
            StrCmp $0 "success" +3
              MessageBox MB_OK|MB_ICONEXCLAMATION "$(decompressionFailed)$\n$0"
              Quit
          !else
            File /oname=$PLUGINSDIR\app-64.${COMPRESSION_METHOD} "${APP_64}"
            Nsis7z::Extract "$PLUGINSDIR\app-64.${COMPRESSION_METHOD}"
            Delete "$PLUGINSDIR\app-64.${COMPRESSION_METHOD}"
          !endif
        !else
          !insertmacro extractEmbeddedAppPackage
        !endif
      !else
        !insertmacro extractEmbeddedAppPackage
      !endif
    !else
      !insertmacro extractEmbeddedAppPackage
    !endif

    # fallback 模式（cacheState=miss）：解压进 $PLUGINSDIR，直接启动，不晋升不写 marker
    StrCmp $cacheState "staging" 0 launch

    # 解压完成，立即把安装器 CWD 移出暂存目录。否则后续 Rename 晋升会因
    # 「该目录是某进程的当前工作目录」被占用而失败（ERROR_SHARING_VIOLATION），
    # 导致每次冷启动都误入 promote_race → race_giveup 从暂存启动、缓存永不落地
    # （v1.3.1 实测踩中：CWD 停在暂存目录，Rename 100% 失败）。
    SetOutPath "$PLUGINSDIR"

    # ---------- 暂存目录关键文件校验（Nsis7z 吞错，只能自己验）----------
    IfFileExists "$INSTDIR\${APP_EXECUTABLE_FILENAME}" 0 verify_fail
    IfFileExists "$INSTDIR\ffmpeg.dll" 0 verify_fail
    IfFileExists "$INSTDIR\icudtl.dat" 0 verify_fail
    IfFileExists "$INSTDIR\resources\app.asar" 0 verify_fail
    Goto promote

  verify_fail:
    # 暂存半截：删掉，最后一搏——直接解压进 $PLUGINSDIR 启动（无缓存但一定能用）
    RMDir /r "$INSTDIR"
    Goto fallback

  promote:
    # ---- 晋升前先判正式缓存是否已完整（marker + 关键文件）----
    # 并发铁律：完整缓存绝不能删。旧版无条件 RMDir $cacheDir 会在并发时把
    # 另一实例刚晋升、Electron 正在使用的完整缓存删成半截（v1.3.1 并发实测踩中：
    # A 晋升并启动 → B 到 promote 把 A 的缓存 RMDir 成只剩被锁的 exe → 缓存半截）。
    # 已完整 → 删自己暂存 → 直接复用，永不碰别人的缓存。
    IfFileExists "$cacheMarker" 0 not_ready
    IfFileExists "$cacheDir\ffmpeg.dll" 0 not_ready
    IfFileExists "$cacheDir\icudtl.dat" 0 not_ready
    RMDir /r "$INSTDIR"
    StrCpy $INSTDIR "$cacheDir"
    StrCpy $cacheState "hit"
    Goto launch

  not_ready:
    # 缓存不存在或不完整 → 原子 Rename 认领（目标已存在即失败，天然互斥，
    # 绝不预删，杜绝踩掉并发实例的缓存）。先改名者赢，写 marker。
    ClearErrors
    Rename "$INSTDIR" "$cacheDir"
    IfErrors rename_failed
    StrCpy $INSTDIR "$cacheDir"
    StrCpy $cacheState "extracted"
    FileOpen $0 "$cacheMarker" w
    FileWrite $0 "${VERSION}"
    FileClose $0
    Goto launch

  rename_failed:
    # Rename 失败：cacheDir 已存在——并发实例抢先晋升，或上次崩溃的半截残留。
    # 合法晋升毫秒级即写 marker，等它（解压本身耗时数秒，此缓冲极宽裕）。
    StrCpy $waitCount 0
  rf_wait:
    IfFileExists "$cacheMarker" rf_ready
    Sleep 500
    IntOp $waitCount $waitCount + 1
    IntCmp $waitCount 12 rf_dead rf_wait rf_dead
  rf_ready:
    # 对方晋升完成 → 删自己暂存 → 复用（同样不碰正式缓存）
    RMDir /r "$INSTDIR"
    StrCpy $INSTDIR "$cacheDir"
    StrCpy $cacheState "hit"
    Goto launch
  rf_dead:
    # 等满 6s 仍无 marker → 确认是上次崩溃遗留的死半截（无实例在晋升）。
    # 删掉它 + 重试认领。删不动（被锁）则 Rename 再失败 → 从暂存兜底启动。
    ClearErrors
    RMDir /r "$cacheDir"
    ClearErrors
    Rename "$INSTDIR" "$cacheDir"
    IfErrors rf_dead2
    StrCpy $INSTDIR "$cacheDir"
    StrCpy $cacheState "extracted"
    FileOpen $0 "$cacheMarker" w
    FileWrite $0 "${VERSION}"
    FileClose $0
    Goto launch
  rf_dead2:
    # 极端并发下重试仍失败：暂存已校验完整，从暂存启动，退出后清暂存
    StrCpy $cacheState "miss"

  launch:
    # ---- 诊断日志：仅 DANGO_TRACE=1 时写盘，正式启动零日志 I/O ----
    StrCpy $traceOn "0"
    ReadEnvStr $8 "DANGO_TRACE"
    StrCmp $8 "1" trace_enabled trace_after_header
  trace_enabled:
      StrCpy $traceOn "1"
      FileOpen $9 "$EXEDIR\.launch-log.txt" w
      FileWrite $9 "state=$cacheState$\n"
      FileWrite $9 "INSTDIR=$INSTDIR$\n"
      FileWrite $9 "EXEDIR=$EXEDIR$\n"
      FileWrite $9 "EXEPATH=$EXEPATH$\n"
      FileWrite $9 "APP_EXE=${APP_EXECUTABLE_FILENAME}$\n"
      FileClose $9
  trace_after_header:

    System::Call 'Kernel32::SetEnvironmentVariable(t, t)i ("PORTABLE_EXECUTABLE_DIR", "$EXEDIR").r0'
    System::Call 'Kernel32::SetEnvironmentVariable(t, t)i ("PORTABLE_EXECUTABLE_FILE", "$EXEPATH").r0'
    System::Call 'Kernel32::SetEnvironmentVariable(t, t)i ("PORTABLE_EXECUTABLE_APP_FILENAME", "${APP_FILENAME}").r0'
    ${StdUtils.GetAllParameters} $R0 0

    StrCmp $traceOn "1" trace_write_params trace_after_params
  trace_write_params:
      FileOpen $9 "$EXEDIR\.launch-log.txt" a
      FileWrite $9 "PARAMS=[$R0]$\n"
      FileWrite $9 "CMD=$\"$INSTDIR\${APP_EXECUTABLE_FILENAME}$\" $R0$\n"
      FileClose $9
  trace_after_params:

    !ifdef SPLASH_IMAGE
      BgImage::Destroy
    !endif

    # 统一把 CWD 切到最终 $INSTDIR：L1 命中=缓存目录、L2 晋升后=缓存目录、
    # race_giveup/fallback=暂存或 $PLUGINSDIR\app。Electron/Chromium 的相对路径
    # 解析依赖 CWD，晋升时已把 CWD 移到 $PLUGINSDIR（避让 Rename），此处必须切回。
    SetOutPath "$INSTDIR"

    # 必须把 exe 路径作为独立的带引号 token。产品名含空格，未加引号时
    # CreateProcess 会把命令行拆成错误的可执行路径，NSIS 仍可能返回 0。
    ExecWait '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" $R0' $0

    StrCmp $traceOn "1" trace_write_result trace_after_result
  trace_write_result:
      FileOpen $9 "$EXEDIR\.launch-log.txt" a
      FileWrite $9 "EXEC_RC=$0$\n"
      FileClose $9
  trace_after_result:

    SetErrorLevel $0

    # 缓存模式：保留目录，下次秒开；回退模式：清掉临时目录
    StrCmp $cacheState "miss" cleanup_fallback
    Goto done

  cleanup_fallback:
    SetOutPath $EXEDIR
    RMDir /r "$INSTDIR"

  done:
SectionEnd
