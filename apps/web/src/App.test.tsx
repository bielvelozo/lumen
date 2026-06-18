import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { App } from './App';

afterEach(cleanup);

describe('App', () => {
  it('renders the Lumen wordmark without crashing', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Lumen' })).toBeInTheDocument();
  });
});
