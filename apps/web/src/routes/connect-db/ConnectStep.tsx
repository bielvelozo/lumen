import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  dbConnectionConfigSchema,
  type DbConnectionConfig,
  type DbConnectionState,
  type ConnectionErrorCategory,
} from '@lumen/shared';
import { Card, Button } from '../../design-system/ui';
import { CopyIcon } from '../../design-system/icons';
import { FormField } from '../../forms/FormField';
import { getOnboardingScript, createConnection, retestConnection } from '../../lib/connect-db';
import { ApiError, asValidationBody } from '../../lib/api-client';
import { CONNECT_DB_KEYS } from '../../lib/connect-db-queries';

const ERROR_MESSAGES: Record<ConnectionErrorCategory, string> = {
  auth_failed: 'Falha de autenticação — verifique usuário e senha.',
  host_unreachable: 'Servidor inacessível — verifique o host.',
  connection_refused: 'Conexão recusada — verifique host e porta.',
  timeout: 'Tempo esgotado ao conectar.',
  ssl_error: 'Erro de SSL/TLS na conexão.',
  database_not_found: 'Banco de dados não encontrado.',
  access_denied: 'Acesso negado para esse usuário.',
  unknown: 'Não foi possível conectar.',
};

/** Step 2/3/4 — onboarding script (solid code panel) + credential form + test result. */
export function ConnectStep({ connection }: { connection: DbConnectionState }): JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {connection.status === 'failed' && <TestResult connection={connection} />}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: 24, alignItems: 'start' }}>
        <CredentialForm />
        <ScriptPanel />
      </div>
    </div>
  );
}

function TestResult({ connection }: { connection: DbConnectionState }): JSX.Element {
  const queryClient = useQueryClient();
  const retest = useMutation({
    mutationFn: retestConnection,
    onSuccess: (state) => {
      queryClient.setQueryData(CONNECT_DB_KEYS.connection, state);
      queryClient.invalidateQueries({ queryKey: CONNECT_DB_KEYS.exposure });
    },
  });
  const message = connection.lastError ? ERROR_MESSAGES[connection.lastError] : ERROR_MESSAGES.unknown;
  return (
    <Card style={{ borderColor: 'var(--c-neg)', background: 'var(--c-neg-soft)' }}>
      <h2 style={{ marginTop: 0 }}>Teste de conexão falhou</h2>
      {/* Only the sanitized category — never a raw driver string. */}
      <p role="alert" aria-live="polite" style={{ color: 'var(--c-neg)' }}>
        {message}
      </p>
      <Button type="button" variant="ghost" disabled={retest.isPending} onClick={() => retest.mutate()}>
        {retest.isPending ? 'Testando…' : 'Testar novamente'}
      </Button>
    </Card>
  );
}

function ScriptPanel(): JSX.Element {
  const [databaseName, setDatabaseName] = useState('');
  const [copied, setCopied] = useState(false);
  const script = useMutation({
    mutationFn: () => getOnboardingScript(databaseName ? { databaseName } : {}),
  });

  const onCopy = async (): Promise<void> => {
    const text = script.data?.script;
    if (!text) return;
    try {
      await navigator.clipboard?.writeText(text);
      setCopied(true);
    } catch {
      /* clipboard may be unavailable; the script is still selectable */
    }
  };

  return (
    <Card>
      <h2 style={{ marginTop: 0 }}>Script de usuário somente leitura</h2>
      <p style={{ color: 'var(--c-text-2)', marginTop: 0 }}>
        Gere o script, rode-o no SEU servidor MySQL para criar um usuário com permissão de
        leitura apenas, escolha sua própria senha e nunca use o usuário root.
      </p>
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', marginBottom: 14 }}>
        <div style={{ flex: 1 }}>
          <FormField
            label="Nome do banco (opcional)"
            name="script-db"
            value={databaseName}
            onChange={setDatabaseName}
          />
        </div>
        <Button type="button" variant="ghost" disabled={script.isPending} onClick={() => script.mutate()}>
          {script.isPending ? 'Gerando…' : 'Gerar script'}
        </Button>
      </div>
      {script.data && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 12 }}>
          {/* Solid code panel — the owner must read/copy this EXACTLY. Never on glass. */}
          <pre data-testid="onboarding-script" className="code" style={{ alignSelf: 'stretch' }}>
            {script.data.script}
          </pre>
          <Button type="button" variant="ghost" icon={<CopyIcon />} onClick={onCopy}>
            {copied ? 'Copiado!' : 'Copiar script'}
          </Button>
        </div>
      )}
    </Card>
  );
}

const INITIAL = { host: '', port: '3306', databaseName: '', username: '', password: '' };

/** The credential form. Reused by the dashboard's "edit credentials" (the password stays
 * write-only and blank on edit — spec 08 keeps the stored secret if none is provided). */
export function CredentialForm({ onSaved }: { onSaved?: () => void } = {}): JSX.Element {
  const queryClient = useQueryClient();
  const [values, setValues] = useState<Record<string, string>>(INITIAL);
  const [sslEnabled, setSslEnabled] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [overPrivileged, setOverPrivileged] = useState(false);

  const create = useMutation({
    mutationFn: (config: DbConnectionConfig) => createConnection(config),
    onSuccess: (state) => {
      queryClient.setQueryData(CONNECT_DB_KEYS.connection, state);
      queryClient.invalidateQueries({ queryKey: CONNECT_DB_KEYS.exposure });
      onSaved?.();
    },
    onError: (error) => {
      if (error instanceof ApiError) {
        if (error.status === 422) {
          setOverPrivileged(true);
          return;
        }
        const body = asValidationBody(error.body);
        if (body?.fields) setErrors(body.fields);
      }
    },
  });

  const set = (key: string) => (value: string): void => setValues((p) => ({ ...p, [key]: value }));

  const onSubmit = (e: FormEvent): void => {
    e.preventDefault();
    setErrors({});
    setOverPrivileged(false);
    // Validate against the SHARED schema (UX only; the server is the boundary).
    const parsed = dbConnectionConfigSchema.safeParse({
      host: values.host,
      port: Number(values.port),
      databaseName: values.databaseName,
      username: values.username,
      password: values.password,
      sslEnabled,
    });
    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? '_');
        if (!fieldErrors[key]) fieldErrors[key] = issue.message;
      }
      setErrors(fieldErrors);
      return;
    }
    create.mutate(parsed.data);
  };

  return (
    <Card>
      <h2 style={{ marginTop: 0 }}>Credenciais do banco</h2>
      <form onSubmit={onSubmit} noValidate style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <FormField label="Host" name="host" value={values.host ?? ''} error={errors.host} onChange={set('host')} />
        <FormField label="Porta" name="port" value={values.port ?? ''} error={errors.port} onChange={set('port')} inputMode="numeric" />
        <FormField label="Banco de dados" name="databaseName" value={values.databaseName ?? ''} error={errors.databaseName} onChange={set('databaseName')} />
        <FormField label="Usuário (somente leitura)" name="username" value={values.username ?? ''} error={errors.username} onChange={set('username')} autoComplete="off" />
        <FormField label="Senha" name="password" type="password" value={values.password ?? ''} error={errors.password} onChange={set('password')} autoComplete="off" />
        <label style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 14 }}>
          <input type="checkbox" checked={sslEnabled} onChange={(e) => setSslEnabled(e.target.checked)} />
          Usar SSL/TLS
        </label>
        {overPrivileged && (
          <p role="alert" style={{ color: 'var(--c-neg)', fontSize: 13, margin: 0 }}>
            Essa credencial não é somente leitura. Rode o script de onboarding para criar um
            usuário com permissão apenas de SELECT.
          </p>
        )}
        <Button type="submit" disabled={create.isPending}>
          {create.isPending ? 'Conectando e testando…' : 'Conectar e testar'}
        </Button>
      </form>
    </Card>
  );
}
