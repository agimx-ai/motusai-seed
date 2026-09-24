import { initials } from '../lib/display'

export function UserAvatar({ name, imageUrl, className }: { name: string; imageUrl?: string; className: string }) {
  return <span className={className} aria-hidden="true">
    {imageUrl ? <img className="h-full w-full object-cover" src={imageUrl} alt="" /> : initials(name)}
  </span>
}
