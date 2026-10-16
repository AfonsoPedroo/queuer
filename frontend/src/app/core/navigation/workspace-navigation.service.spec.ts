import { WorkspaceNavigationService } from './workspace-navigation.service';

const setup = () => {
  const mixes = {
    selectedMix: vi.fn(() => null),
    clearSelection: vi.fn(),
    openMix: vi.fn(),
  };
  const store = { activeCollection: vi.fn(() => 'home') };
  const integration = { openCollection: vi.fn().mockResolvedValue(undefined) };
  const navigation = new WorkspaceNavigationService(
    store as never,
    mixes as never,
    integration as never,
  );
  return { navigation, mixes, integration };
};

describe('WorkspaceNavigationService history', () => {
  it('goes back and forward across collections like a browser', () => {
    const { navigation, integration } = setup();

    navigation.openCollection('liked');
    navigation.openCollection('recent');
    expect(navigation.canGoBack()).toBe(true);
    expect(navigation.canGoForward()).toBe(false);

    navigation.back();
    expect(integration.openCollection).toHaveBeenLastCalledWith('liked', { reuse: true });
    navigation.back();
    expect(integration.openCollection).toHaveBeenLastCalledWith('home', { reuse: true });
    expect(navigation.canGoBack()).toBe(false);

    navigation.forward();
    expect(integration.openCollection).toHaveBeenLastCalledWith('liked', { reuse: true });
    expect(navigation.canGoForward()).toBe(true);
  });

  it('drops forward entries after a new visit and ignores repeated visits', () => {
    const { navigation, integration } = setup();

    navigation.openCollection('liked');
    navigation.openCollection('liked');
    navigation.openCollection('recent');
    navigation.back();
    navigation.openCollection('artist:x');

    expect(navigation.canGoForward()).toBe(false);
    navigation.back();
    expect(integration.openCollection).toHaveBeenLastCalledWith('liked', { reuse: true });
  });

  it('restores a mix entry through the mix engine and does nothing at the ends', () => {
    const { navigation, mixes, integration } = setup();

    navigation.back();
    navigation.forward();
    expect(integration.openCollection).not.toHaveBeenCalled();

    navigation.openMix({ id: 'daily-2' } as never);
    navigation.goHome();
    navigation.back();

    expect(mixes.openMix).toHaveBeenLastCalledWith('daily-2');
  });
});
