import { forwardRef, type InputHTMLAttributes } from 'react';
import { cx } from '../utils';

export const TextInputControl = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function TextInputControl({ className, ...props }, ref) {
    return <input ref={ref} className={cx('seed-text-input', className)} {...props} />;
  },
);
