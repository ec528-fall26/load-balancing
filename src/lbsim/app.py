"""Launch with PYTHONPATH=src uv run streamlit run src/lbsim/app.py."""
import streamlit as st

from lbsim.simulation import run_simulation
from lbsim.settings import build_config
from lbsim.results import display_summary
from lbsim.exports import build_exports
from lbsim.saved_runs import load_configuration, replay_configuration
from lbsim.comparison import display_saved_comparison

st.set_page_config(page_title="Load balancing simulator", layout="wide")

POLICY_LABELS = {"round_robin": "Round robin",
                 "least_active_requests": "Least active requests"}

with st.sidebar:
    st.header("Configure a run")
    with st.form("simulation_settings"):
        st.subheader("Servers")
        server_count = st.number_input("Server count", value=2, step=1, key="server_count")
        concurrency = st.number_input("Slots per server", value=1, step=1, key="concurrency",
                                      help="Requests each server can process at once.")
        queue_limit = st.number_input("Waiting places per server", value=10, step=1,
                                      key="queue_limit", help="Zero rejects requests when all slots are busy.")
        policy = st.selectbox("Routing policy", list(POLICY_LABELS),
                             format_func=POLICY_LABELS.get, key="policy",
                             help="Least active counts running requests only; ties favor the lowest server ID. "
                                  "Waiting requests do not count and full targets reject without retrying.")
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
    saved_configuration = None
    replay_requested = False
    with st.expander("Replay a saved run"):
        upload = st.file_uploader("Configuration export (JSON)", type=["json"],
                                  key="saved_config_upload")
        if upload is not None:
            try:
                saved_configuration = load_configuration(upload.getvalue())
            except ValueError as error:
                st.error(str(error))
            else:
                st.json(saved_configuration.config)
                st.caption("Replay uses these saved settings and seed, independently "
                           "of the settings form above. It verifies the saved metrics "
                           "before replacing the current results.")
                replay_requested = st.button("Replay saved configuration")

st.title("Load balancing simulator")
st.write("Explore how traffic and server capacity affect waiting, latency, and rejected requests.")
run_feedback = st.container()

if submitted or replay_requested:
    try:
        config = (saved_configuration.config if replay_requested else
                  build_config(server_count=server_count, concurrency=concurrency,
                               queue_limit=queue_limit, policy=policy, arrival_rate=arrival_rate,
                               duration=duration, service_min=service_min, service_max=service_max,
                               seed=seed))
        with run_feedback, st.spinner("Running simulation..."):
            summary = (replay_configuration(saved_configuration) if replay_requested
                       else run_simulation(config))
    except ValueError as error:
        if submitted:
            st.session_state.pop("config", None)
            st.session_state.pop("summary", None)
        run_feedback.error(str(error))
    else:
        for key in list(st.session_state):
            if key.startswith("playback_"):
                del st.session_state[key]
        st.session_state["config"] = config
        st.session_state["summary"] = summary
        if replay_requested:
            run_feedback.success("Replay verified: configuration and exported metrics match the saved run.")

if "config" in st.session_state and "summary" in st.session_state:
    config = st.session_state["config"]
    st.caption(f"Last completed run · {config['server_count']} servers · "
               f"{config['arrival_rate']:g} requests/s · {config['duration']:g} s arrival window · "
               f"seed {config['seed']} · {POLICY_LABELS[config['policy']]}")
    display_summary(st.session_state["summary"], config)
    with st.expander("Run configuration"):
        st.json(config)
    with st.expander("Download run"):
        exports = build_exports(config, st.session_state["summary"])
        st.caption("Download the last completed run's configuration and results. "
                   "CSV includes summary metrics and per-server utilization.")
        configuration, results = st.columns(2)
        configuration.download_button(
            "Download configuration (JSON)", data=exports.config_json,
            file_name=f"lbsim-{exports.run_id[:12]}-config.json",
            mime="application/json", on_click="ignore",
        )
        results.download_button(
            "Download results (CSV)", data=exports.results_csv,
            file_name=f"lbsim-{exports.run_id[:12]}-results.csv",
            mime="text/csv", on_click="ignore",
        )
else:
    st.info("Configure your servers and traffic in the sidebar, then select Run simulation.")
    st.subheader("What you'll see")
    st.write("Request outcomes show whether capacity kept up with traffic. Response times include "
             "both queue waiting and service. Server utilization shows how evenly work was distributed.")

display_saved_comparison()
