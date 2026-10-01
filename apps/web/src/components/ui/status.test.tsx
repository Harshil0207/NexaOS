import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ExecutionStatusPill } from './status';

describe('ExecutionStatusPill', () => {
  it.each([
    ['COMPLETED', 'Completed'],
    ['FAILED', 'Failed'],
    ['WAITING_FOR_TOOL', 'Calling tool'],
    ['TIMED_OUT', 'Timed out'],
  ] as const)('labels %s with words, not colour alone', (status, label) => {
    const { container } = render(<ExecutionStatusPill status={status} />);
    expect(screen.getByText(label)).toBeInTheDocument();
    expect(container.querySelector('svg[aria-hidden]')).not.toBeNull();
  });
});
