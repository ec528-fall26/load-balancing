"""Launch with uv run streamlit run src/lbsim/app.py."""
import streamlit as st

from lbsim.simulation import run_simulation
from lbsim.settings import build_config
from lbsim.results import display_summary

st.set_page_config(page_title="Load balancing simulator", page_icon="⚖️")
st.title("Load balancing simulator")
st.write("Choose your servers and traffic settings.")
st.caption("Arrivals are evenly spaced. Service times are sampled using the random seed.")
with st.form("simulation_settings"):
    left, right = st.columns(2)
    with left:
        st.subheader("Servers")
        server_count = st.number_input("Server count", value=2, step=1, key="server_count")
        concurrency = st.number_input("Slots per server", value=1, step=1, key="concurrency")
        queue_limit = st.number_input("Waiting queue limit per server", value=10, step=1,
                                      key="queue_limit", help="Zero means no waiting queue.")
        policy = st.selectbox("Routing policy", ["round_robin"],
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
    submitted = st.form_submit_button("Run simulation", type="primary")

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
    st.success("Simulation complete.")
    st.subheader("Run configuration")
    st.json(st.session_state["config"])
    st.subheader("Results")
    display_summary(st.session_state["summary"])
