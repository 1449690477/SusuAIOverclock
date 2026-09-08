import React from 'react';
import SusuAvatar from './SusuAvatar';

export default function MascotCat({
  size = 64,
  waving = true
}: {
  size?: number;
  waving?: boolean;
}) {
  return <SusuAvatar size={size} waving={waving} />;
}
