import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import {
  ThemeProvider,
  ThemeToggle,
  GlassPanel,
  Button,
  Card,
  MetricCard,
  NavItem,
  Avatar,
} from './ui';

afterEach(cleanup);
beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});

describe('design-system components', () => {
  it('GlassPanel carries the .glass class (chrome only)', () => {
    const { container } = render(<GlassPanel>frame</GlassPanel>);
    expect(container.querySelector('.glass')).toBeInTheDocument();
  });

  it('Button reflects its variant class and defaults to type=button', () => {
    render(<Button variant="ghost">Limpar</Button>);
    const btn = screen.getByRole('button', { name: 'Limpar' });
    expect(btn).toHaveClass('btn', 'btn--ghost');
    expect(btn).toHaveAttribute('type', 'button');
  });

  it('Card and MetricCard render on solid surfaces (.card / .metric)', () => {
    const { container } = render(
      <>
        <Card>data</Card>
        <MetricCard label="Vendas" value="R$ 128.000" delta="+12%" trend="up" />
      </>,
    );
    expect(container.querySelector('.card')).toBeInTheDocument();
    expect(container.querySelector('.metric')).toBeInTheDocument();
    expect(container.querySelector('.metric__delta--up')).toBeInTheDocument();
    expect(screen.getByText('R$ 128.000')).toBeInTheDocument();
  });

  it('NavItem marks the active item and Avatar shows initials', () => {
    const { container } = render(
      <>
        <NavItem active>Início</NavItem>
        <Avatar initials="GV" />
      </>,
    );
    expect(container.querySelector('.nav-item--on')).toBeInTheDocument();
    expect(screen.getByText('GV')).toHaveClass('avatar');
  });
});

describe('theme', () => {
  it('toggles data-theme on <html> and persists to localStorage', () => {
    render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>,
    );
    // default (no saved value, no matchMedia in jsdom) is light
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    fireEvent.click(screen.getByRole('button', { name: /tema/i }));
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(localStorage.getItem('theme')).toBe('dark');
  });
});
