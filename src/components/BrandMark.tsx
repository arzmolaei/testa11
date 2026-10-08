/** The same local vector mark is used in the app, favicon and installed app icons. */
export function BrandMark({ size = 44 }: { size?: number }) {
  return <img className="brand-mark" src="/icon.svg" width={size} height={size} alt="" aria-hidden="true" draggable={false} />;
}
