"""Launch with PYTHONPATH=src uv run streamlit run src/lbsim/app.py."""
import streamlit as st

from lbsim.simulation import run_simulation
from lbsim.settings import build_config
from lbsim.results import display_summary

st.set_page_config(page_title="Load balancing simulator", layout="wide")

with st.sidebar:
    st.header("Configure a run")
    with st.form("simulation_settings"):
        st.subheader("Servers")
        server_count = st.number_input("Server count", value=2, step=1, key="server_count")
        concurrency = st.number_input("Slots per server", value=1, step=1, key="concurrency",
                                      help="Requests each server can process at once.")
        queue_limit = st.number_input("Waiting places per server", value=10, step=1,
                                      key="queue_limit", help="Zero rejects requests when all slots are busy.")
        policy = st.selectbox("Routing policy", ["round_robin"], disabled=True,
                             format_func=lambda x: "Round robin", key="policy")
        st.subheader("Traffic")
        arrival_rate = st.number_input("Requests per second", value=1.0, key="arrival_rate")
        duration = st.number_input("Arrival window (seconds)", value=60.0, key="duration")
        low, high = st.columns(2)
        service_min = low.number_input("Min service (s)", value=0.1, format="%.3f", key="service_min")
        service_max = high.number_input("Max service (s)", value=1.0, format="%.3f", key="service_max")
        with st.expander("Repeatability"):
            seed = st.number_input("Random seed", value=42, step=1, key="seed")
            st.caption("Keep the settings and seed unchanged to repeat a run.")
        submitted = st.form_submit_button("Run simulation", type="primary", width="stretch")
    st.caption("Evenly spaced arrivals, sampled service times, and identical servers.")

st.title("Load balancing simulator")
st.write("Explore how traffic and server capacity affect waiting, latency, and rejected requests.")

if submitted:
    try:
        config = build_config(server_count=server_count, concurrency=concurrency,
                              queue_limit=queue_limit, policy=policy, arrival_rate=arrival_rate,
                              duration=duration, service_min=service_min, service_max=service_max,
                              seed=seed)
        with st.spinner("Running simulation..."):
            summary = run_simulation(config)
    except ValueError as error:
        st.session_state.pop("config", None)
        st.session_state.pop("summary", None)
        st.error(str(error))
    else:
        st.session_state["config"] = config
        st.session_state["summary"] = summary

if "config" in st.session_state and "summary" in st.session_state:
    config = st.session_state["config"]
    st.caption(f"Last completed run · {config['server_count']} servers · "
               f"{config['arrival_rate']:g} requests/s · {config['duration']:g} s arrival window · "
               f"seed {config['seed']} · Round robin")
    display_summary(st.session_state["summary"])
    with st.expander("Run configuration"):
        st.json(config)
else:
    st.info("Configure your servers and traffic in the sidebar, then select Run simulation.")
    st.subheader("What you'll see")
    st.write("Request outcomes show whether capacity kept up with traffic. Response times include "
             "both queue waiting and service. Server utilization shows how evenly work was distributed.")
