"use client";

import { useEffect } from 'react';
import { wsClient } from '@/lib/websocket-client';
import { useStudentStore } from '@/hooks/use-student-store';

export default function WsInitializer(): null {
  useEffect(() => {
    // Ensure socket tries to connect early
    try {
      wsClient.connect();
    } catch (e) {
      console.warn('WsInitializer: connect failed', e);
    }

    let mounted = true;

    // Fetch static filters and populate store (best-effort)
    wsClient.getStaticFilters().then((resp) => {
      if (!mounted) return;
      const actions = useStudentStore.getState().actions;
      if (actions && typeof actions.setFilterOptions === 'function') {
        actions.setFilterOptions({
          grades: resp.grades || [],
          classes: resp.classes || [],
          roles: resp.roles || [],
        });
      }
    }).catch((err) => {
      console.warn('WsInitializer: getStaticFilters failed', err);
    });

    return () => { mounted = false; };
  }, []);

  return null;
}
