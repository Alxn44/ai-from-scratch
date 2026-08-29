const placeholders = /changeme|cambia|example|placeholder|secret/i;

function secret(name: string, value = process.env[name]): string {
  if (!value || value.length < 32 || placeholders.test(value)) {
    throw new Error(`${name} must contain at least 32 non-placeholder characters`);
  }
  return value;
}

function required(name: string, value = process.env[name]): string {
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export interface Config {
  host: string;
  port: number;
  databaseUrl: string;
  serviceSecret: string;
}

export function loadConfig(): Config {
  return {
    host: process.env.HOST ?? '127.0.0.1',
    port: Number(process.env.PORT ?? 8786),
    databaseUrl: required('DATABASE_URL'),
    serviceSecret: secret('MESSAGES_SECRET'),
  };
}
