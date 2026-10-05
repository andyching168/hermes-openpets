// Minimal ambient types: the real SDK is resolved by Hermes at load time.
declare module "@hermes/plugin-sdk" {
  export const host: any;
  export const PALETTE_AREA: string;
}
