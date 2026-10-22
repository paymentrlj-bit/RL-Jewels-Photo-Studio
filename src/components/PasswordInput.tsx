import React, { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

interface PasswordInputProps {
  value: string;
  onChange: (value: string) => void;
  /** "new-password" stops the browser filling in a saved password where a NEW one is being set. */
  autoComplete: 'current-password' | 'new-password';
  className: string;
  id?: string;
  placeholder?: string;
  ariaLabel?: string;
  autoFocus?: boolean;
}

// A password box with an eye to see what was typed - most "wrong password"
// problems on a phone are a typo or autocorrect nobody can see.
export const PasswordInput: React.FC<PasswordInputProps> = ({ value, onChange, autoComplete, className, id, placeholder, ariaLabel, autoFocus }) => {
  const [shown, setShown] = useState(false);
  return (
    <div className={`relative ${className.includes('flex-1') ? 'flex-1 min-w-[200px]' : ''}`}>
      <input
        id={id}
        type={shown ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        autoFocus={autoFocus}
        placeholder={placeholder}
        aria-label={ariaLabel}
        className={`${className.replace('flex-1', '').replace('min-w-[200px]', '')} w-full pr-11`}
      />
      <button
        type="button"
        onClick={() => setShown((s) => !s)}
        aria-label={shown ? 'Hide password' : 'Show password'}
        className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-stone-500 hover:text-stone-800"
      >
        {shown ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
      </button>
    </div>
  );
};
