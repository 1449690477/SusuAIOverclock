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
#      L2 缓存缺失/损坏 → 直接 7z 解压到缓存目录（跳过 CopyFiles 中转），写完成标记
#      L3 缓存不可写   → 回退原生 $PLUGINSDIR 行为（每次解压，但功能不受影响）
#
#  缓存位置：%LOCALAPPDATA%\SusuAIOverclock-cache\<VERSION>\
#  失效条件：主 exe 不存在，或完成标记缺失
#  清理方式：删除该目录即可，下次启动会重新解压
# ============================================================================

!include "common.nsh"
!include "extractAppPackage.nsh"
!include "LogicLib.nsh"

CRCCheck off
WindowIcon Off
AutoCloseWindow True
RequestExecutionLevel ${REQUEST_EXECUTION_LEVEL}

Var /GLOBAL cacheDir
Var /GLOBAL cacheMarker
Var /GLOBAL cacheState
Var /GLOBAL traceOn

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
  StrCpy $cacheDir "$cacheDir\SusuAIOverclock-cache\${VERSION}"
  StrCpy $cacheMarker "$cacheDir\.cache-complete"

  # ---------- L1: 缓存命中判定 ----------
   IfFileExists "$cacheDir\${APP_EXECUTABLE_FILENAME}" 0 try_extract
   IfFileExists "$cacheMarker" 0 try_extract
   StrCpy $INSTDIR "$cacheDir"
   # 命中缓存时也显式切换 CWD；Electron/Chromium 的相对路径解析不能依赖
   # 启动器当前目录（双击和命令行启动的 CWD 不一致）。SetOutPath 这里只
   # 设置工作目录，不会复制任何文件。
   SetOutPath "$INSTDIR"
   StrCpy $cacheState "hit"
   Goto launch

  # ---------- L2: 解压到缓存目录 ----------
  try_extract:
    ClearErrors
    CreateDirectory "$cacheDir"
    IfErrors fallback
    # 探测可写性（只读介质 / 权限受限时走 fallback）
    FileOpen $0 "$cacheDir\.probe" w
    IfErrors fallback
    FileClose $0
    Delete "$cacheDir\.probe"
    # 清掉半截缓存。Windows Defender/索引器偶尔会让递归删除返回错误，
    # 但目标目录仍然可写；不能因为这个清理返回值把整个启动降级到
    # $PLUGINSDIR，否则每次双击都会重新走临时目录，热启动永远失效。
    ClearErrors
    RMDir /r "$cacheDir"
    ClearErrors
    CreateDirectory "$cacheDir"
    IfErrors fallback
    StrCpy $INSTDIR "$cacheDir"
    StrCpy $cacheState "extracted"
    Goto do_extract

  # ---------- L3: 缓存不可写，回退原生行为 ----------
  fallback:
    StrCpy $INSTDIR "$PLUGINSDIR\app"
    RMDir /r $INSTDIR

  # ---------- 唯一的文件落地代码（宏只能插入一次）----------
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

    # 只有真正解压进缓存时才写完成标记
    StrCmp $cacheState "extracted" 0 launch
    FileOpen $0 "$cacheMarker" w
    FileWrite $0 "${VERSION}"
    FileClose $0

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
