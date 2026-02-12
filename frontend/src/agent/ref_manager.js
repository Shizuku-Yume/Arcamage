import { listRefs, registerRefFile, unregisterRef } from './ref_registry.js';

export function syncAgentRefs(agent) {
  if (!agent) return;
  agent.refs = listRefs();
}

export async function handleRefUpload({ files, agent, toast }) {
  const list = Array.from(files || []);
  if (list.length === 0) return;

  for (const file of list) {
    const result = await registerRefFile(file);
    if (result.status !== 'ok') {
      toast?.error?.(result.message || '附件处理失败');
      continue;
    }
    if (result.warnings?.length) {
      const message = result.warnings.map((warn) => warn.message || warn.code).join('；');
      if (message) {
        toast?.show?.({ message, type: 'warning', duration: 6000 });
      }
    }
  }

  syncAgentRefs(agent);
}

export function removeRefById({ refId, agent }) {
  if (!refId) return;
  unregisterRef(refId);
  syncAgentRefs(agent);
}

export default {
  syncAgentRefs,
  handleRefUpload,
  removeRefById,
};
