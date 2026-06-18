import { create } from 'zustand';

type Zone = 'reader' | 'control';
type ModalId = 'calendar' | 'profile' | 'threshold' | 'dismissed';

type UIState = {
  zone: Zone;
  activeModal: ModalId | null;

  setZone: (zone: Zone) => void;
  openModal: (modal: ModalId) => void;
  closeModal: () => void;
};

export type { Zone, ModalId };

export const useUIStore = create<UIState>((set) => ({
  zone: 'reader',
  activeModal: null,

  setZone: (zone) => set({ zone }),
  openModal: (modal) => set({ activeModal: modal }),
  closeModal: () => set({ activeModal: null }),
}));
