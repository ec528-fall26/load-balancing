"""Launch with uv run streamlit run src/lbsim/app.py."""
import streamlit as st

from lbsim.metrics import summarize
from lbsim.server import Execution, Request
from lbsim.settings import build_config
from lbsim.results import display_summary

st.set_page_config(page_title="Load balancing simulator", page_icon="⚖️")
st.title("Load balancing simulator")
st.write("Choose your servers and traffic settings.")
st.info("Settings preview only. The simulation engine is not connected yet.")
with st.form("simulation_settings"):
    left, right = st.columns(2)
    with left:
        st.subheader("Servers")
        server_count = st.number_input("Server count", value=2, step=1, key="server_count")
        concurrency = st.number_input("Slots per server", value=1, step=1, key="concurrency")
        queue_limit = st.number_input("Waiting queue limit per server", value=10, step=1,
                                      key="queue_limit", help="Zero means no waiting queue.")
        policy = st.selectbox("Routing policy", ["round_robin", "least_active_requests"],
                             format_func=lambda x: x.replace("_", " ").capitalize(), key="policy")
    with right:
        st.subheader("Traffic")
        arrival_rate = st.number_input("Arrival rate (requests/second)", value=1.0, key="arrival_rate")
        duration = st.number_input("Arrival window (seconds)", value=60.0, key="duration")
        service_min = st.number_input("Minimum service time (seconds)", value=0.1,
                                      format="%.3f", key="service_min")
        service_max = st.number_input("Maximum service time (seconds)", value=1.0,
                                      format="%.3f", key="service_max")
        seed = st.number_input("Random seed", value=42, step=1, key="seed")
    submitted = st.form_submit_button("Preview settings", type="primary")

if submitted:
    try:
        config = build_config(server_count=server_count, concurrency=concurrency,
                              queue_limit=queue_limit, policy=policy, arrival_rate=arrival_rate,
                              duration=duration, service_min=service_min, service_max=service_max,
                              seed=seed)
    except ValueError as error:
        st.session_state.pop("config", None)
        st.error(str(error))
    else:
        st.session_state["config"] = config

if "config" in st.session_state:
    st.success("Settings are valid.")
    st.subheader("Selected configuration")
    st.json(st.session_state["config"])
    st.subheader("Sample results")
    st.caption("Fixed example: one server, one slot, a 4-second arrival window. "
               "These results do not reflect your selected settings.")
    example = [Execution(Request(0, 0, 3), 0, 0, 3),
               Execution(Request(1, 1, 2), 0, 3, 5),
               Execution(Request(3, 3, 1), 0, 5, 6)]
    summary = summarize(example, [2], duration=4, server_capacities={0: 1})
    display_summary(summary)
