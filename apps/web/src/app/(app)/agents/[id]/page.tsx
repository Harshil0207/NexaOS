import { Suspense } from 'react';
import { AgentBuilder } from '@/components/agents/agent-builder';

export const metadata = { title: 'Agent' };

export default async function AgentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense>
      <AgentBuilder id={id} />
    </Suspense>
  );
}
