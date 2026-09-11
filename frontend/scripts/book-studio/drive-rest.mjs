// Scoped operator token supplied explicitly; no credential discovery or sharing changes.
export function driveRest(accessToken, request = fetch) {
  if (!accessToken?.trim()) throw new Error('A scoped Google Drive OAuth access token is required.');
  const base = 'https://www.googleapis.com';
  const id = value => { if (!/^[a-zA-Z0-9_-]+$/.test(value)) throw new Error('Invalid Drive ID.'); return value; };
  async function call(url, options = {}) {
    const target = new URL(url);
    if (target.origin !== base) throw new Error('Unexpected Drive upload origin.');
    const response = await request(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(240000), headers: { ...options.headers, Authorization: `Bearer ${accessToken}` } });
    if (!response.ok) throw new Error(`Drive request failed (${response.status}); reconcile before retrying.`);
    return response;
  }
  return {
    async get(fileId) {
      const fields = 'id,name,mimeType,size,md5Checksum,parents,permissions(type,role),shared,driveId,trashed';
      return (await call(`${base}/drive/v3/files/${id(fileId)}?fields=${encodeURIComponent(fields)}`)).json();
    },
    async list(folderId, name) {
      if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name)) throw new Error('Invalid backup name.');
      const q = `'${id(folderId)}' in parents and name = '${name}' and trashed = false`;
      const data = await (await call(`${base}/drive/v3/files?${new URLSearchParams({ q, fields:'files(id),nextPageToken', pageSize:'100' })}`)).json();
      if (data.nextPageToken) throw new Error('Ambiguous paginated upload inventory.');
      return data.files;
    },
    async upload(folderId, name, bytes) {
      const opened = await call(`${base}/upload/drive/v3/files?uploadType=resumable&fields=id`, {method:'POST',headers:{'Content-Type':'application/json','X-Upload-Content-Type':'application/octet-stream','X-Upload-Content-Length':String(bytes.length)},body:JSON.stringify({name,parents:[id(folderId)]})});
      const location = opened.headers.get('location');
      if (!location) throw new Error('Drive did not return an upload session.');
      // One PUT; an uncertain result stops. Next invocation discovers completed files
      // by exact folder/name and downloads them before reusing. No chunk recovery claimed.
      return (await call(location,{method:'PUT',headers:{'Content-Type':'application/octet-stream','Content-Length':String(bytes.length)},body:bytes})).json();
    },
    async download(fileId) { return Buffer.from(await (await call(`${base}/drive/v3/files/${id(fileId)}?alt=media`)).arrayBuffer()); },
  };
}
