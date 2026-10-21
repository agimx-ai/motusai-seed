import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { actionButtonClassName, type ActionButtonTone } from '../../button-style';

type ActionButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  icon?: ReactNode;
  tone?: ActionButtonTone;
  busy?: boolean;
};

export function ActionButton({
  icon,
  tone = 'neutral',
  busy = false,
  className = '',
  children,
  disabled,
  ...props
}: ActionButtonProps) {
  return (
    <button
      className={`${actionButtonClassName(tone)} ${className}`}
      disabled={disabled || busy}
      {...props}
    >
      {icon}
      {children}
    </button>
  );
}
