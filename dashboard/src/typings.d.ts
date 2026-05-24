declare module '*.css';
declare module '*.less';
declare module '*.svg';
declare module '*.png';

declare const __APP_VERSION__: string;
declare const __UMI_VERSION__: string;

declare namespace API {
  export type Role = 'admin' | 'user';

  export interface CurrentUser {
    id?: string;
    name: string;
    email: string;
    role: Role;
  }
}
