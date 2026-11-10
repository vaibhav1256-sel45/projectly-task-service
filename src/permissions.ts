// Who may do what in a project. Viewing comes with every role; the owner can do everything.
export type Permission = 'view' | 'edit' | 'delete';

const ROLE_PERMISSIONS: Record<string, Permission[]> = {
  OWNER: ['view', 'edit', 'delete'],
  ADMIN: ['view', 'edit', 'delete'],
  EDITOR: ['view', 'edit'],
  DELETOR: ['view', 'delete'],
  VIEWER: ['view'],
};

export const can = (role: string, permission: Permission) => (ROLE_PERMISSIONS[role] ?? []).includes(permission);

export const permissionError = (permission: Permission) =>
  `Your role in this project does not allow you to ${permission} this`;
