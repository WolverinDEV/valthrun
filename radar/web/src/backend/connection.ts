import { EventEmitter } from "../utils/ee";
import { C2SMessage, RadarState, S2CMessage } from "./definitions";


export type SubscriberClientState = {
    state: "new" | "connecting" | "initializing" | "connected" | "disconnected",
} | {
    state: "failed",
    reason: string
};

export interface SubscriberClientEvents {
    "state_changed": SubscriberClientState,
    "radar.state": RadarState,
}

type T = S2CMessage;
export class SubscriberClient {
    readonly events: EventEmitter<SubscriberClientEvents>;

    private currentState: SubscriberClientState;
    private connection: WebSocket | null;

    private commandHandler: { [T in S2CMessage["type"]]?: (payload: (S2CMessage & { type: T })["payload"]) => void } = {};

    constructor(
        readonly targetAddress: string,
    ) {
        this.events = new EventEmitter();
        this.currentState = { state: "new" };
        this.connection = null;

        this.commandHandler = {};
        this.commandHandler["response-error"] = payload => {
            this.updateState({ state: "failed", reason: payload.error });
            this.closeSocket();
        };

        this.commandHandler["response-session-invalid-id"] = () => {
            this.updateState({ state: "failed", reason: "session does not exists" });
            this.closeSocket();
        };

        this.commandHandler["response-subscribe-success"] = () => {
            this.updateState({ state: "connected" });
        };

        this.commandHandler["notify-radar-state"] = payload => {
            this.events.emit("radar.state", payload.state)
        };

        this.commandHandler["notify-session-closed"] = () => {
            this.updateState({ state: "disconnected" });
        };
    }

    public getState(): Readonly<SubscriberClientState> {
        return this.currentState;
    }

    private updateState(newState: SubscriberClientState) {
        if (this.currentState === newState) {
            return;
        }

        this.currentState = newState;
        this.events.emit("state_changed", newState as any);
    }

    private closeSocket() {
        if (!this.connection) {
            return;
        }

        this.connection.onopen = undefined;
        this.connection.onclose = undefined;
        this.connection.onerror = undefined;
        this.connection.onmessage = undefined;
        if (this.connection.readyState === WebSocket.OPEN) {
            this.connection.close();
        }
        this.connection = null;
    }

    public connect(sessionId: string) {
        if (this.currentState.state != "new") {
            throw new Error(`invalid session state`);
        }

        this.updateState({ state: "connecting" });
        this.connection = new WebSocket(this.targetAddress);
        this.connection.onopen = () => {
            this.updateState({ state: "initializing" });
            this.sendCommand("initialize-subscribe", {
                version: 1,
                session_id: sessionId
            });
        };

        this.connection.onerror = () => {
            this.updateState({ state: "failed", reason: "web socket error" });
            this.closeSocket();
        };

        this.connection.onclose = () => {
            if (this.currentState.state !== "disconnected") {
                this.updateState({ state: "failed", reason: "web socket closed" });
                this.closeSocket();
            }
        };

        this.connection.onmessage = event => {
            let payload = JSON.parse(event.data as string) as S2CMessage;
            if (typeof payload === "string") {
                payload = { [payload]: null } as any;
            }

            const commandHandler = this.commandHandler[payload.type];
            if (typeof commandHandler === "function") {
                commandHandler(payload.payload as any);
            }
        };
    }

    public sendCommand<T extends C2SMessage["type"]>(command: T, payload: (C2SMessage & { type: T })["payload"]) {
        this.connection.send(JSON.stringify({
            type: command,
            payload
        }));
    }
}

export const kDefaultRadarState: RadarState = {
    players: [],
    worldName: "<empty>",

    c4Entities: [],
    plantedC4: null
};