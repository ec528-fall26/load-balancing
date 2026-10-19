"""Server racks showing average utilization or time-controlled event playback."""

from html import escape
from time import monotonic
from math import ceil
import streamlit as st
from lbsim.playback import Playback

SERVERS_PER_RACK = 8
PAGE_SIZE = 32


def slot_stack(occupied: int, total: int, active_label: str, color: str) -> str:
    if total == 0:
        return '<div class="dc-empty">Disabled</div>'
    blocks = []
    # Bound tall stacks; grouped blocks retain exact position counts.
    for count, label, fill, foreground in ((occupied, active_label, color, '#FFFFFF'),
                                          (total - occupied, 'Available', '#E8EEF2', '#334E60')):
        chunk = max(1, ceil(count / 4))
        for start in range(0, count, chunk):
            size = min(chunk, count - start)
            text = label if size == 1 else f'{label} × {size}'
            blocks.append(f'<div class="dc-slot" style="background:{fill};color:{foreground}">{text}</div>')
    return '<div class="dc-stack">' + ''.join(blocks) + '</div>'


def rack_view(servers: list[tuple[int, float]], first_rack: int = 1,
              states: dict | None = None, capacity: int = 1, queue_limit: int = 0) -> str:
    racks = []
    for start in range(0, len(servers), SERVERS_PER_RACK):
        slots = []
        for server_id, utilization in servers[start:start + SERVERS_PER_RACK]:
            sid = escape(str(server_id))
            if states is None:
                percent = min(1, max(0, utilization)) * 100
                content = f'''<div class="dc-label dc-section"><span>Average utilization</span><span>{percent:.1f}%</span></div>
                    <div class="dc-meter" role="meter" aria-label="Server {sid} slot utilization"
                        aria-valuemin="0" aria-valuemax="100" aria-valuenow="{percent:.1f}">
                        <div style="width:{percent:.2f}%;background:#006477"></div>
                    </div>'''
            else:
                running, queued = states[server_id]
                full = ' · Full' if queue_limit and queued == queue_limit else ''
                state_label = 'Queue full' if full else ('Queued' if queued else ('Executing' if running else 'Idle'))
                state_color = '#9A3D08' if queued else ('#006477' if running else '#334E60')
                execution_stack = slot_stack(running, capacity, 'Running', '#006477')
                queue_stack = slot_stack(queued, queue_limit, 'Waiting', '#9A3D08')
                content = f'''<div class="dc-state" style="color:{state_color}">{state_label}</div>
                    <div class="dc-stacks">
                        <div><div class="dc-label dc-section"><span>Executing</span><span>{running}/{capacity}</span></div>
                            {execution_stack}</div>
                        <div><div class="dc-label dc-section"><span>Waiting{full}</span><span>{queued}/{queue_limit}</span></div>
                            {queue_stack}</div>
                    </div>'''
            slots.append(f'<div class="dc-server"><strong>Server {sid}</strong>{content}</div>')
        rack_number = first_rack + start // SERVERS_PER_RACK
        racks.append(f'<section class="dc-rack" aria-label="Display rack {rack_number}">'
                     f'<h4>Rack {rack_number}</h4>{"".join(slots)}</section>')
    return '''<style>
.dc-floor {display:grid;grid-template-columns:repeat(auto-fit,minmax(min(210px,100%),1fr));gap:20px;align-items:start}
.dc-rack {background:#EDF2F5;border-radius:12px;padding:14px;min-width:0}
.dc-rack h4 {color:#102A3A;margin:0 0 14px;font-size:14px;font-weight:600}
.dc-server {background:#FFFFFF;color:#102A3A;border-radius:5px;padding:12px;margin-bottom:8px}
.dc-server:last-child {margin-bottom:0}
.dc-label {display:flex;justify-content:space-between;gap:12px;font-size:14px;line-height:1.5}
.dc-label span {font-variant-numeric:tabular-nums;font-weight:600}
.dc-section {color:#334E60;margin-top:12px}
.dc-meter {height:6px;background:#D3DFE5;margin-top:6px;border-radius:2px;overflow:hidden}
.dc-meter div {height:100%}
.dc-state {font-size:12px;font-weight:600;margin-top:4px}
.dc-stacks {display:grid;grid-template-columns:1fr 1fr;gap:12px}
.dc-stacks .dc-label {display:block;font-size:12px}
.dc-stacks .dc-label span {display:block}
.dc-stack {display:flex;flex-direction:column;gap:4px;margin-top:8px}
.dc-slot {padding:6px 8px;border-radius:3px;font-size:12px;font-weight:600}
.dc-empty {color:#334E60;font-size:12px;margin-top:8px}
</style><div class="dc-floor">''' + ''.join(racks) + '</div>'


def playback_time(end):
    now = st.session_state.playback_time
    if st.session_state.playback_playing:
        now += (monotonic() - st.session_state.playback_anchor) * st.session_state.playback_rate
    return min(end, now)


def display_datacenter(utilization: dict, config: dict | None = None, events: list | None = None):
    st.subheader('Datacenter')
    st.caption('Racks group servers for display; they do not model physical locations or network topology.')
    servers = sorted(utilization.items())
    if not servers:
        st.info('No servers to display.')
        return
    page = 0
    if len(servers) > PAGE_SIZE:
        page = st.selectbox('Servers to display', range((len(servers) + PAGE_SIZE - 1) // PAGE_SIZE),
                            format_func=lambda p: f"Servers {servers[p * PAGE_SIZE][0]}–"
                            f"{servers[min((p + 1) * PAGE_SIZE, len(servers)) - 1][0]}", key='datacenter_page')
    visible = servers[page * PAGE_SIZE:(page + 1) * PAGE_SIZE]
    first_rack = page * PAGE_SIZE // SERVERS_PER_RACK + 1
    mode = st.radio('View', ['Playback', 'Run averages'], horizontal=True) if config is not None else 'Run averages'
    if mode == 'Run averages':
        st.html(rack_view(visible, first_rack))
        st.caption(f'Showing {len(visible)} of {len(servers)} servers. Bars show average occupied slots during the arrival window.')
        return

    end = max(config['duration'], events[-1][0] if events else 0)
    defaults = {'playback_time': 0.0, 'playback_playing': False, 'playback_anchor': monotonic(),
                'playback_speed': 1.0, 'playback_rate': 1.0, 'playback_engine': Playback(events or [], config['server_count'])}
    for key, value in defaults.items():
        if key not in st.session_state:
            st.session_state[key] = value
    # Freeze the clock while changing controls, then resume from this anchor.
    st.session_state.playback_time = playback_time(end)
    st.session_state.playback_anchor = monotonic()
    play, restart, speed = st.columns([1, 1, 2])
    if play.button('Pause' if st.session_state.playback_playing else 'Play', width='stretch'):
        if st.session_state.playback_time >= end:
            st.session_state.playback_time = 0.0
        st.session_state.playback_playing = not st.session_state.playback_playing
        st.session_state.playback_anchor = monotonic()
        st.rerun()
    if restart.button('Restart', width='stretch'):
        st.session_state.playback_time = 0.0
        st.session_state.playback_anchor = monotonic()
        st.session_state.playback_playing = False
        st.session_state.playback_seek = 0.0
        st.rerun()
    def change_speed():
        st.session_state.playback_time = playback_time(end)
        st.session_state.playback_anchor = monotonic()
        st.session_state.playback_rate = st.session_state.playback_speed

    speed.selectbox('Playback speed', [0.25, 0.5, 1.0, 2.0, 5.0, 10.0],
                    format_func=lambda v: f'{v:g}×', key='playback_speed', on_change=change_speed)

    def seek():
        st.session_state.playback_time = st.session_state.playback_seek
        st.session_state.playback_anchor = monotonic()

    st.slider('Jump to time (seconds)', 0.0, float(end), step=min(0.1, end / 100),
              key='playback_seek', on_change=seek)
    st.caption('1× plays one simulated second per real second. Playback follows the recorded run, including queue draining. '
               'Teal: running. Orange: waiting. Labels show current slot and queue counts.')

    @st.fragment(run_every=0.2 if st.session_state.playback_playing else None)
    def frame():
        now = playback_time(end)
        state = st.session_state.playback_engine.advance(now)
        running = sum(s[0] for s in state.servers.values())
        queued = sum(s[1] for s in state.servers.values())
        status = 'Finished' if now >= end else ('Playing' if st.session_state.playback_playing else 'Paused')
        st.write(f'**{status} · {now:.1f} / {end:.1f} s**')
        st.progress(min(1.0, now / end))
        if state.latest:
            t, sid, _, _, action, request_id = state.latest
            st.caption(f'Latest event · {t:.3f} s · Request {request_id} {action} on server {sid}')
        live = [(sid, state.servers[sid][0] / config['concurrency']) for sid, _ in visible]
        arrived = running + queued + state.completed + state.rejected
        total = int(config['arrival_rate'] * config['duration'])
        stats = [('Not arrived', total - arrived, '#334E60'),
                 ('Running', running, '#006477'), ('Waiting', queued, '#9A3D08'),
                 ('Completed', state.completed, '#17683B'), ('Rejected', state.rejected, '#A12727')]
        rows = ''.join(f'<div class="dc-pool-row"><span style="color:{color}">{label}</span>'
                       f'<strong>{count:,}</strong></div>' for label, count, color in stats)
        pool = (f'<section class="dc-pool-rack" aria-label="Task pool rack"><h4>Task pool</h4>'
                f'{rows}<p class="dc-pool-note">{arrived:,} arrived / {total:,} total requests.<br>'
                'Counts cover all servers.</p></section>')
        layout = '''<style>
.dc-scene {container-type:inline-size;container-name:dcscene}
.dc-scene-grid {display:grid;grid-template-columns:minmax(0,1fr) 260px;gap:20px;align-items:start}
.dc-scene-grid > div {min-width:0}
.dc-pool-rack {background:#EDF2F5;border-radius:12px;padding:14px;color:#102A3A;min-width:0}
.dc-pool-rack h4 {color:#102A3A;margin:0 0 14px;font-size:14px;font-weight:600}
.dc-pool-row {display:grid;grid-template-columns:minmax(0,1fr) max-content;align-items:center;gap:12px;
    padding:14px 12px;background:#FFFFFF;border-radius:5px;margin-bottom:8px;font-size:14px}
.dc-pool-row span {font-weight:600;overflow-wrap:anywhere}
.dc-pool-row strong {color:#102A3A;font-variant-numeric:tabular-nums}
.dc-pool-note {color:#334E60;font-size:12px;line-height:1.5;margin:14px 0 0}
@container dcscene (max-width:650px) {.dc-scene-grid {grid-template-columns:minmax(0,1fr)}}
</style>'''
        racks = rack_view(live, first_rack, state.servers, config['concurrency'], config['queue_limit'])
        st.html(layout + f'<div class="dc-scene"><div class="dc-scene-grid"><div>{racks}</div>{pool}</div></div>')
        st.caption(f'Showing {len(visible)} of {len(servers)} servers. Large stacks group positions; × indicates the count.')
        if now >= end and st.session_state.playback_playing:
            st.session_state.playback_time = end
            st.session_state.playback_playing = False
            st.rerun()
    frame()
