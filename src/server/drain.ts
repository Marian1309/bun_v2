let isDrainingNow = false;

/** One-way: once set, readiness fails and upgrades are refused until the process exits. */
export const markDraining = () => {
  isDrainingNow = true;
};

export const isDraining = (): boolean => isDrainingNow;
