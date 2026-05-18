import { useCallback, useEffect, useState } from "react";
import type { IpcPushEvent } from "../../shared/ipc-types";
import { ipc } from "../lib/ipc-client";

export interface UsePendingItemsOptions<T> {
  channel: IpcPushEvent["type"];
  decode: (data: unknown) => T | null;
  getKey: (item: T) => string;
}

export interface UsePendingItemsResult<T> {
  items: T[];
  add: (item: T) => void;
  remove: (item: T) => void;
  clearWhere: (predicate: (item: T) => boolean) => void;
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

  const clearWhere = useCallback((predicate: (item: T) => boolean) => {
    setItems((prev) => prev.filter((item) => !predicate(item)));
  }, []);

  useEffect(() => {
    const unsub = ipc.on(channel, (event) => {
      const item = decode(event);
      if (item) add(item);
    });
    return unsub;
  }, [channel, decode, add]);

  return { items, add, remove, clearWhere };
}
