"""Replay the event loop's state changes without changing simulation results."""

class Playback:
    def __init__(self, events: list, server_count: int):
        self.events = events
        self.server_count = server_count
        self.reset()

    def reset(self):
        self.time = -1.0
        self.cursor = 0
        self.servers = {i: (0, 0) for i in range(self.server_count)}
        self.completed = 0
        self.rejected = 0
        self.latest = None

    def advance(self, now: float):
        if now < self.time:
            self.reset()
        while self.cursor < len(self.events) and self.events[self.cursor][0] <= now:
            event = self.events[self.cursor]
            _, server_id, running, queued, action, _ = event
            self.servers[server_id] = (running, queued)
            self.completed += action == 'completed'
            self.rejected += action == 'rejected'
            self.latest = event
            self.cursor += 1
        self.time = now
        return self
