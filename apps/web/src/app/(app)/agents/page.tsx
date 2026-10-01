import { Suspense } from 'react';
import { AgentsList } from '@/components/agents/agents-list';

export const metadata = { title: 'Agents' };

export default function AgentsPage() {
  return (
    <Suspense>
      <AgentsList />
    </Suspense>
  );
}
