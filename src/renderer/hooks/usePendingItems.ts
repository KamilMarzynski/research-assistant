import { useCallback, useEffect, useState } from "react";
import type { IpcChannel } from "../../shared/ipc-channels";

export interface UsePendingItemsOptions<T> {
  channel: IpcChannel;
  decode: (data: unknown) => T | null;
  getKey: (item: T) => string;
}

export interface UsePendingItemsResult<T> {
  items: T[];
  add: (item: T) => void;
  remove: (item: T) => void;
}

export function usePendingItems<T>({
  channel,
  decode,
  getKey,
}: UsePendingItemsOptions<T>): UsePendingItemsResult<T> {
  const [items, setItems] = useState<T[]>([]);

  const add = useCallback(
    (item: T) => {
      const key = getKey(item);
      setItems((prev) => {
        if (prev.some((p) => getKey(p) === key)) return prev;
        return [...prev, item];
      });
    },
    [getKey],
  );

  const remove = useCallback(
    (item: T) => {
      const key = getKey(item);
      setItems((prev) => prev.filter((p) => getKey(p) !== key));
    },
    [getKey],
  );

  useEffect(() => {
    const unsub = window.electronAPI.on(channel, (data) => {
      const item = decode(data);
      if (item) add(item);
    });
    return unsub;
  }, [channel, decode, add]);

  return { items, add, remove };
}
