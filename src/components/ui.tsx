import { Check, LoaderCircle, LockKeyhole } from 'lucide-react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'

export function Button({ variant = 'primary', className = '', children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger' }) {
  return <button className={`button button-${variant} ${className}`} {...props}>{children}</button>
}

export function Badge({ tone = 'neutral', children }: { tone?: 'neutral' | 'teal' | 'green' | 'amber' | 'red' | 'blue'; children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>
}

export function StageState({ complete, locked }: { complete?: boolean; locked?: boolean }) {
  if (locked) return <LockKeyhole size={14} aria-label="Locked" />
  if (complete) return <Check size={15} aria-label="Complete" />
  return <span className="stage-dot" />
}

export function EmptyState({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return <div className="empty-state"><div className="empty-icon">{icon}</div><strong>{title}</strong><p>{text}</p></div>
}

export function Loading({ label = 'Working…' }: { label?: string }) {
  return <span className="loading"><LoaderCircle className="spin" size={16} />{label}</span>
}
