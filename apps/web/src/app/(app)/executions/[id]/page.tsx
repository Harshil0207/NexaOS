import { ExecutionDetailView } from '@/components/executions/execution-detail';

export const metadata = { title: 'Execution' };

export default async function ExecutionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ExecutionDetailView id={id} />;
}
