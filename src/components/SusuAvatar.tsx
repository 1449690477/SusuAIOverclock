import React from 'react';
import avatarImg from '../assets/susu-avatar.png';

export interface SusuAvatarProps {
  size?: number;
  waving?: boolean;
  showBadge?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * 苏苏专属头像组件
 * 融合用户定制头像与梦幻二次元呼吸柔光边框
 */
export default function SusuAvatar({
  size = 42,
  waving = true,
  showBadge = true,
  className = '',
  style = {}
}: SusuAvatarProps) {
  const badgeSize = Math.max(12, Math.round(size * 0.32));

  return (
    <div
      className={`susu-avatar-wrap ${waving ? 'susu-wave' : ''} ${className}`}
      style={{
        position: 'relative',
        width: size,
        height: size,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        ...style
      }}
      data-testid="mascot-cat"
      role="img"
      aria-label="苏苏 AI超频"
    >
      {/* 呼吸外光晕圈 */}
      <div
        className="susu-halo"
        style={{
          position: 'absolute',
          inset: -3,
          borderRadius: '50%',
          background: 'linear-gradient(135deg, #ffc7d9 0%, #b8c7ff 50%, #ffd4ea 100%)',
          boxShadow: '0 0 14px rgba(255, 183, 197, 0.65)',
          opacity: 0.92,
          zIndex: 1
        }}
      />

      {/* 头像本体容器 */}
      <div
        style={{
          position: 'relative',
          width: size,
          height: size,
          borderRadius: '50%',
          overflow: 'hidden',
          border: '2px solid #ffffff',
          boxShadow: '0 2px 8px rgba(108, 92, 231, 0.18)',
          backgroundColor: '#fff',
          zIndex: 2
        }}
      >
        <img
          src={avatarImg}
          alt="苏苏"
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            display: 'block'
          }}
        />
      </div>

      {/* 右下角萌萌小闪光微章 */}
      {showBadge && size >= 28 && (
        <span
          className="susu-badge-sparkle"
          style={{
            position: 'absolute',
            right: -2,
            bottom: -2,
            width: badgeSize,
            height: badgeSize,
            borderRadius: '50%',
            background: 'linear-gradient(135deg, #ffd166, #ff758c)',
            border: '1.5px solid #ffffff',
            boxShadow: '0 1px 4px rgba(0,0,0,0.15)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: Math.max(9, Math.round(badgeSize * 0.65)),
            lineHeight: 1,
            zIndex: 3,
            color: '#ffffff'
          }}
        >
          ✨
        </span>
      )}
    </div>
  );
}
