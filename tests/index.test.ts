describe('Basic test suite', () => {
  it('should pass a basic test', () => {
    expect(true).toBe(true);
  });

  it('should add two numbers correctly', () => {
    const result = 2 + 2;
    expect(result).toBe(4);
  });
});
