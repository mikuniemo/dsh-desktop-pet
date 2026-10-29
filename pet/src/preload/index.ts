import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type {
  CharacterId,
  FoodPayload,
  MotionAction,
  PetAct,
  PetApi,
  PetCommand,
  PetSnapshot,
  WalkState
} from '../shared/types'

function subscribe<T>(channel: string, callback: (payload: T) => void): () => void {
  const listener = (_event: Electron.IpcRendererEvent, payload: T) => callback(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: PetApi = {
  bootstrap: () => ipcRenderer.invoke('app:bootstrap') as Promise<PetSnapshot>,
  getFilePath: (file: File) => webUtils.getPathForFile(file),
  petReady: () => ipcRenderer.send('pet:ready'),
  petPointer: (inside: boolean) => ipcRenderer.send('pet:pointer', inside),
  petDragStart: () => ipcRenderer.send('pet:drag-start'),
  petDragEnd: () => ipcRenderer.send('pet:drag-end'),
  petClick: () => ipcRenderer.send('pet:click'),
  petDoubleClick: () => ipcRenderer.send('pet:double-click'),
  feedFiles: (paths: string[]) => ipcRenderer.invoke('pet:feed', paths) as Promise<FoodPayload | null>,
  setCharacter: (id: CharacterId) => ipcRenderer.send('pet:set-character', id),
  openBelly: () => ipcRenderer.send('belly:open'),
  quit: () => ipcRenderer.send('app:quit'),
  onSnapshot: (callback: (snapshot: PetSnapshot) => void) => subscribe('pet:snapshot', callback),
  onAct: (callback: (act: PetAct) => void) => subscribe('pet:act', callback),
  onCommand: (callback: (command: PetCommand) => void) => subscribe('pet:command', callback),
  onWalk: (callback: (state: WalkState) => void) => subscribe('pet:walk', callback),
  onMotionAction: (callback: (action: MotionAction) => void) => subscribe('pet:action', callback),
  onSay: (callback: (payload: { text: string; inner: boolean }) => void) => subscribe('pet:say', callback)
}

contextBridge.exposeInMainWorld('petAPI', api)
