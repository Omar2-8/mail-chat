import { useEffect, useState } from 'react';
import type { Person } from '../../../shared/types';
import { api } from '../api';
import { hueOf, initials } from '../lib/format';

const photoCache = new Map<string, Promise<string | null>>();
const resolved = new Map<string, string | null>();

function loadPhoto(email: string): Promise<string | null> {
  const key = email.toLowerCase();
  let pending = photoCache.get(key);
  if (!pending) {
    pending = api.photo(key).catch(() => null);
    pending.then((value) => resolved.set(key, value));
    photoCache.set(key, pending);
  }
  return pending;
}

export function usePhoto(email: string | undefined): string | null {
  const key = (email ?? '').toLowerCase();
  const [photo, setPhoto] = useState<string | null>(() => resolved.get(key) ?? null);
  useEffect(() => {
    if (!key) return;
    let alive = true;
    const known = resolved.get(key);
    if (known !== undefined) {
      setPhoto(known);
      return;
    }
    void loadPhoto(key).then((value) => alive && setPhoto(value));
    return () => {
      alive = false;
    };
  }, [key]);
  return photo;
}

export function Avatar({ person, size = 36, ring }: { person: Person; size?: number; ring?: boolean }) {
  const photo = usePhoto(person.email);
  const hue = hueOf(person.email || person.name);
  const style = {
    width: size,
    height: size,
    fontSize: Math.round(size * 0.38),
    '--h': hue
  } as React.CSSProperties;
  return (
    <span className={`avatar${ring ? ' ring' : ''}`} style={style} title={`${person.name}${person.email ? ` <${person.email}>` : ''}`}>
      {photo ? <img src={photo} alt="" draggable={false} /> : <span>{initials(person)}</span>}
    </span>
  );
}

export function GroupAvatar({ people, size = 44 }: { people: Person[]; size?: number }) {
  if (people.length <= 1) return <Avatar person={people[0] ?? { name: '?', email: '' }} size={size} />;
  const small = Math.round(size * 0.68);
  return (
    <span className="group-avatar" style={{ width: size, height: size }}>
      <span className="ga-back">
        <Avatar person={people[1]} size={small} />
      </span>
      <span className="ga-front">
        <Avatar person={people[0]} size={small} ring />
      </span>
    </span>
  );
}
