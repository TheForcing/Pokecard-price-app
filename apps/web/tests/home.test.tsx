import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import HomePage from '../app/page';

describe('HomePage', () => {
  it('renders the title', () => {
    render(<HomePage />);

    expect(screen.getByRole('heading', { name: /price finder/i })).toBeInTheDocument();
  });
});
