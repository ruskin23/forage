/// <reference types="@electron-forge/plugin-vite/forge-vite-env" />

declare module '*.sql?raw' {
  const content: string;
  export default content;
}
