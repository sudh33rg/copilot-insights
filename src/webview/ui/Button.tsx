import type { ButtonHTMLAttributes } from 'react';

export function Button({
  variant = 'secondary',
  className,
  type = 'button',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' }) {
  return (
    <button type={type} className={`btn btn--${variant}${className ? ` ${className}` : ''}`} {...rest} />
  );
}
