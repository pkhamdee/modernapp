/** A Product photo from the image service; a neutral placeholder keeps the layout when there is none. */
export function ProductPhoto({ src, alt = '', large = false }: { src: string | null; alt?: string; large?: boolean }) {
  const className = large ? 'product-photo large' : 'product-photo'
  if (!src) return <span className={className} aria-hidden="true" />
  return <img className={className} src={src} alt={alt} loading="lazy" width={400} height={400} />
}
