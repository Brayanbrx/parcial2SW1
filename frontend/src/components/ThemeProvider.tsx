import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  useRef,
  useId,
  type ReactNode,
} from 'react';

type ThemePreference = 'light' | 'dark' | 'system';
type Theme = 'light' | 'dark';
const KEY = 'umlforge.theme';
const QUERY = '(prefers-color-scheme: dark)';
const normalize = (value: string | null): ThemePreference =>
  value === 'light' || value === 'dark' ? value : 'system';
const ThemeContext = createContext<{
  preference: ThemePreference;
  resolved: Theme;
  setPreference(value: ThemePreference): void;
} | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [preference, setValue] = useState<ThemePreference>(() => {
    try {
      return normalize(localStorage.getItem(KEY));
    } catch {
      return 'system';
    }
  });
  const [systemDark, setSystemDark] = useState(() => window.matchMedia(QUERY).matches);
  const resolved = preference === 'system' ? (systemDark ? 'dark' : 'light') : preference;

  useEffect(() => {
    const media = window.matchMedia(QUERY);
    const onChange = (): void => setSystemDark(media.matches);
    const onStorage = (event: StorageEvent): void => {
      if (event.key === KEY || event.key === null) {
        try {
          setValue(normalize(localStorage.getItem(KEY)));
        } catch {
          /* Conserva la selección actual. */
        }
      }
    };
    onChange();
    media.addEventListener('change', onChange);
    window.addEventListener('storage', onStorage);
    return () => {
      media.removeEventListener('change', onChange);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  useLayoutEffect(() => {
    document.documentElement.dataset['theme'] = resolved;
    document.documentElement.style.colorScheme = resolved;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', resolved === 'dark' ? '#1e1e1e' : '#f5f4f0');
  }, [resolved]);

  const value = useMemo(
    () => ({
      preference,
      resolved,
      setPreference(next: ThemePreference): void {
        setValue(next);
        try {
          localStorage.setItem(KEY, next);
        } catch {
          /* El tema sigue funcionando en esta pestaña. */
        }
      },
    }),
    [preference, resolved],
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): NonNullable<React.ContextType<typeof ThemeContext>> {
  const value = useContext(ThemeContext);
  if (value === null) throw new Error('Falta ThemeProvider');
  return value;
}

export function ThemeSelect(): React.JSX.Element {
  const { preference, setPreference } = useTheme();
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const options = useRef<(HTMLButtonElement | null)[]>([]);
  const menuId = useId();
  const choices = [
    { value: 'light', label: 'Claro', description: 'Superficies luminosas' },
    { value: 'dark', label: 'Oscuro', description: 'Grises al estilo VS Code' },
    { value: 'system', label: 'Sistema', description: 'Seguir la apariencia del equipo' },
  ] as const;
  const selected = choices.findIndex((choice) => choice.value === preference);
  useEffect(() => {
    if (!open) return;
    options.current[selected]?.focus();
    const outside = (event: PointerEvent): void => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open, selected]);
  const close = (): void => {
    setOpen(false);
    trigger.current?.focus();
  };
  return (
    <div
      className="theme-select"
      ref={container}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <button
        type="button"
        className="theme-trigger"
        ref={trigger}
        aria-label="Apariencia"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen(!open)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <ThemeIcon theme={preference} />
        <span>{choices[selected]?.label}</span>
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <path d="m3 4.5 3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.3" />
        </svg>
      </button>
      {open && (
        <div
          className="theme-menu"
          role="menu"
          aria-label="Apariencia"
          id={menuId}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              close();
            }
            const index = options.current.indexOf(document.activeElement as HTMLButtonElement);
            const next =
              event.key === 'ArrowDown'
                ? (index + 1) % 3
                : event.key === 'ArrowUp'
                  ? (index + 2) % 3
                  : event.key === 'Home'
                    ? 0
                    : event.key === 'End'
                      ? 2
                      : null;
            if (next !== null) {
              event.preventDefault();
              options.current[next]?.focus();
            }
          }}
        >
          <p className="theme-menu-title">Apariencia</p>
          {choices.map((choice, index) => (
            <button
              type="button"
              role="menuitemradio"
              aria-label={choice.label}
              aria-checked={preference === choice.value}
              tabIndex={index === selected ? 0 : -1}
              key={choice.value}
              ref={(element) => {
                options.current[index] = element;
              }}
              onClick={() => {
                setPreference(choice.value);
                close();
              }}
            >
              <ThemeIcon theme={choice.value} />
              <span>
                <strong>{choice.label}</strong>
                <small>{choice.description}</small>
              </span>
              {preference === choice.value && (
                <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                  <path d="m3 8 3 3 7-7" fill="none" stroke="currentColor" strokeWidth="1.6" />
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ThemeIcon({ theme }: { theme: ThemePreference }): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 20 20"
      width="17"
      height="17"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {theme === 'light' ? (
        <>
          <circle cx="10" cy="10" r="3.5" />
          <path d="M10 1v2m0 14v2M1 10h2m14 0h2M3.6 3.6 5 5m10 10 1.4 1.4M3.6 16.4 5 15M15 5l1.4-1.4" />
        </>
      ) : theme === 'dark' ? (
        <path d="M16.8 12.2A7.2 7.2 0 0 1 7.8 3.2a7.2 7.2 0 1 0 9 9Z" />
      ) : (
        <>
          <rect x="2" y="3" width="16" height="11" rx="1.5" />
          <path d="M7 18h6m-3-4v4" />
        </>
      )}
    </svg>
  );
}
