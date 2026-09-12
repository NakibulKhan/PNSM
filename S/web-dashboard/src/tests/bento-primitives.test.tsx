/**
 * M5 (master audit): the entire Bento redesign had zero DOM/render coverage.
 * These primitives are exactly where the heading-level contract lives (§10 —
 * hero tiles are h2, everything else h3), and M1 found three real consumers
 * that silently broke it (StatTile, present-now-tile, ActionTile all
 * rendered a plain `<p>` instead of reading `level` from context). A render
 * test on the primitives themselves is what would have caught that class of
 * regression the moment it was introduced, rather than waiting for a manual
 * DOM inspection during an audit.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BentoTile, useTileHeading } from '@/components/bento/BentoTile';
import { TileHeader } from '@/components/bento/TileHeader';
import { TileSkeleton } from '@/components/bento/TileSkeleton';
import { TileEmpty } from '@/components/bento/TileEmpty';
import { TileError } from '@/components/bento/TileError';
import { BentoGrid } from '@/components/bento/BentoGrid';

/** Renders whatever `useTileHeading()` returns, so a test can assert on it directly. */
function HeadingProbe() {
  const { id, level } = useTileHeading();
  return (
    <p data-testid="probe" data-id={id} data-level={level}>
      probe
    </p>
  );
}

describe('BentoTile', () => {
  it('renders a hero tile as a section labelled by its own h2', () => {
    render(
      <BentoTile rank="hero">
        <HeadingProbe />
      </BentoTile>,
    );
    const region = screen.getByRole('region');
    const probe = screen.getByTestId('probe');
    expect(probe.dataset.level).toBe('h2');
    expect(region).toHaveAttribute('aria-labelledby', probe.dataset.id);
  });

  it('renders every non-hero rank as a section labelled by its own h3', () => {
    for (const rank of ['wide', 'tall', 'square', 'chip', 'rail'] as const) {
      const { unmount } = render(
        <BentoTile rank={rank}>
          <HeadingProbe />
        </BentoTile>,
      );
      expect(screen.getByTestId('probe').dataset.level).toBe('h3');
      unmount();
    }
  });

  it('carries the rank as a class name for the CSS grid engine to key off', () => {
    render(
      <BentoTile rank="wide">
        <HeadingProbe />
      </BentoTile>,
    );
    expect(screen.getByRole('region')).toHaveClass('rank-wide');
  });

  it('useTileHeading throws outside a BentoTile, so a consumer cannot silently render an orphaned heading', () => {
    // Swallow the expected console.error React logs for the thrown-during-render case.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<HeadingProbe />)).toThrow('useTileHeading must be used within a BentoTile');
    spy.mockRestore();
  });
});

describe('TileHeader', () => {
  it('renders the title as the tile heading, at the level BentoTile assigned', () => {
    render(
      <BentoTile rank="square">
        <TileHeader title="Assigned office" />
      </BentoTile>,
    );
    const heading = screen.getByRole('heading', { level: 3, name: 'Assigned office' });
    expect(screen.getByRole('region')).toHaveAttribute('aria-labelledby', heading.id);
  });

  it('renders support text and an action when passed', () => {
    render(
      <BentoTile rank="chip">
        <TileHeader title="Check-in radius" support="Metres from the pin" action={<span>50 m</span>} />
      </BentoTile>,
    );
    expect(screen.getByText('Metres from the pin')).toBeInTheDocument();
    expect(screen.getByText('50 m')).toBeInTheDocument();
  });

  it('omits support and action when not passed, rather than rendering empty elements', () => {
    render(
      <BentoTile rank="chip">
        <TileHeader title="Late arrivals" />
      </BentoTile>,
    );
    expect(screen.queryByText('undefined')).not.toBeInTheDocument();
  });
});

describe('tile state primitives', () => {
  it('TileSkeleton renders two placeholder blocks and no text content', () => {
    const { container } = render(<TileSkeleton />);
    expect(container.querySelectorAll('div').length).toBeGreaterThanOrEqual(2);
    expect(container).toHaveTextContent('');
  });

  it('TileEmpty renders the title and message it is given', () => {
    render(<TileEmpty title="Nobody on site" message="This fills as employees check in." />);
    expect(screen.getByText('Nobody on site')).toBeInTheDocument();
    expect(screen.getByText('This fills as employees check in.')).toBeInTheDocument();
  });

  it('TileError falls back to a stated default rather than an empty tile', () => {
    render(<TileError />);
    expect(screen.getByText('Unavailable')).toBeInTheDocument();
  });

  it('TileError renders a custom title and message when given one', () => {
    render(<TileError title="Export failed" message="Try a shorter period." />);
    expect(screen.getByText('Export failed')).toBeInTheDocument();
    expect(screen.getByText('Try a shorter period.')).toBeInTheDocument();
  });

  it('TileError renders the anomaly (red) tone by default — a real failure, not a wait', () => {
    render(<TileError title="Unavailable" />);
    expect(screen.getByText('Unavailable')).toHaveClass('text-anomaly');
    expect(screen.getByText('Unavailable')).not.toHaveClass('text-accent');
  });

  it("TileError's waking prop swaps to the accent tone WakingState itself uses, not anomaly red", () => {
    render(<TileError title="Waking up" waking />);
    expect(screen.getByText('Waking up')).toHaveClass('text-accent');
    expect(screen.getByText('Waking up')).not.toHaveClass('text-anomaly');
  });
});

describe('BentoGrid', () => {
  it('renders its children inside the grid container', () => {
    render(
      <BentoGrid>
        <div data-testid="child">content</div>
      </BentoGrid>,
    );
    expect(screen.getByTestId('child')).toBeInTheDocument();
  });
});
