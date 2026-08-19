import React from 'react';

export default class ErrorBoundary extends React.Component {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    console.error('Render error caught by ErrorBoundary:', error, info);
  }

  componentDidUpdate(prevProps) {
    // Reset the boundary automatically when the route changes, so the
    // user doesn't get stuck on the fallback after navigating away.
    if (prevProps.locationKey !== this.props.locationKey && this.state.hasError) {
      this.setState({ hasError: false });
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 40, textAlign: 'center' }}>
          <h2>Something went wrong loading this page.</h2>
          <button
            onClick={() => window.location.reload()}
            style={{
              marginTop: 12, padding: '10px 20px', borderRadius: 8,
              border: 'none', background: '#1e4010', color: '#fff',
              fontWeight: 700, cursor: 'pointer',
            }}
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}