import { useEffect, useState } from 'react';
import type { PersonSuggestion } from '../../../shared/types';
import { api } from '../api';
import { Icon } from './Icon';

export function TagInput({
  values,
  onChange,
  placeholder,
  people,
  lower = true
}: {
  values: string[];
  onChange: (values: string[]) => void;
  placeholder: string;
  people?: boolean;
  lower?: boolean;
}) {
  const [text, setText] = useState('');
  const [options, setOptions] = useState<PersonSuggestion[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const term = text.trim();
    if (!people || term.length < 2 || term.startsWith('@')) {
      setOptions([]);
      return;
    }
    let alive = true;
    const timer = setTimeout(() => {
      void api.searchPeople(term).then((found) => {
        if (!alive) return;
        setOptions(found.slice(0, 6));
        setOpen(true);
      });
    }, 220);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [text, people]);

  const add = (raw: string) => {
    const value = (lower ? raw.trim().toLowerCase() : raw.trim()).replace(/[,;]+$/, '');
    if (!value) return;
    if (!values.some((item) => item.toLowerCase() === value.toLowerCase())) onChange([...values, value]);
    setText('');
    setOptions([]);
    setOpen(false);
  };

  return (
    <div className="tag-input">
      <div className="picker-box">
        {values.map((value) => (
          <span key={value} className="tag">
            {value}
            <button type="button" className="icon-btn tiny" onClick={() => onChange(values.filter((item) => item !== value))} aria-label={`Remove ${value}`}>
              <Icon name="x" size={12} />
            </button>
          </span>
        ))}
        <input
          value={text}
          placeholder={values.length ? '' : placeholder}
          spellCheck={false}
          onChange={(event) => setText(event.target.value)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(event) => {
            if ((event.key === 'Enter' || event.key === ',' || event.key === ';' || event.key === 'Tab') && text.trim()) {
              event.preventDefault();
              add(text);
            } else if (event.key === 'Backspace' && !text && values.length) {
              onChange(values.slice(0, -1));
            }
          }}
        />
      </div>
      {open && options.length > 0 && (
        <div className="suggest">
          {options.map((option) => (
            <button
              type="button"
              key={option.email}
              className="suggest-item"
              onMouseDown={(event) => {
                event.preventDefault();
                add(option.email);
              }}
            >
              <span>
                <b>{option.name}</b>
                <span className="muted">{option.email}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
