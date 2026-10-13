import { afterEach, describe, expect, it, vi } from 'vitest';

// Firmar un link no hace ningún pedido: se prueba con el SDK de verdad.
async function load(env) {
  vi.resetModules();
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  return import('./files.js');
}

const DEV = {
  S3_ENDPOINT: 'http://minio:9000',
  S3_PUBLIC_ENDPOINT: 'http://127.0.0.1:9000',
  S3_REGION: 'us-east-1',
  S3_BUCKET: 'pid-tddlovers-dev',
  S3_ACCESS_KEY_ID: 'minioadmin',
  S3_SECRET_ACCESS_KEY: 'minioadmin',
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('storage/files', () => {
  it('sin las variables del bucket no está configurado', async () => {
    const { isConfigured } = await load({ S3_ENDPOINT: '', S3_BUCKET: '' });
    expect(isConfigured()).toBe(false);
  });

  it('la clave agrupa por turno y no lleva el nombre del archivo', async () => {
    const { newFileKey } = await load(DEV);
    expect(newFileKey({ teacherId: 't1', date: '2099-09-14', startTime: '13:30' }, 'abc')).toBe(
      'materials/t1/2099-09-14/1330/abc'
    );
  });

  it('el link se firma para el host que ve el navegador, con nombre y tipo', async () => {
    const { isConfigured, signedDownloadUrl } = await load(DEV);
    expect(isConfigured()).toBe(true);

    const url = new URL(
      await signedDownloadUrl('materials/t1/abc', {
        filename: 'Clase de física.pdf',
        mimeType: 'application/pdf',
      })
    );

    expect(url.origin).toBe('http://127.0.0.1:9000');
    expect(url.pathname).toBe('/pid-tddlovers-dev/materials/t1/abc');
    expect(url.searchParams.get('response-content-disposition')).toMatch(/^attachment;/);
    expect(url.searchParams.get('response-content-disposition')).toContain('f%C3%ADsica.pdf');
    expect(url.searchParams.get('response-content-type')).toBe('application/pdf');
    expect(url.searchParams.get('X-Amz-Expires')).toBe('300');
  });

  it('en producción firma con el mismo endpoint', async () => {
    const { signedDownloadUrl } = await load({
      ...DEV,
      S3_ENDPOINT: 'https://s3.us-east-005.backblazeb2.com',
      S3_PUBLIC_ENDPOINT: '',
      S3_REGION: 'us-east-005',
      S3_BUCKET: 'pid-tddlovers',
    });

    const url = new URL(await signedDownloadUrl('k', { filename: 'foto.png', mimeType: 'image/png' }));

    expect(url.origin).toBe('https://s3.us-east-005.backblazeb2.com');
    expect(url.searchParams.get('response-content-disposition')).toMatch(/^inline;/);
  });
});
