"""Display a summary returned by lbsim.metrics.summarize."""

import streamlit as st


def display_summary(summary: dict):
    columns = st.columns(4)
    columns[0].metric("Completed requests", summary["completed_count"])
    columns[1].metric("Rejected requests", summary["rejected_count"])
    for column, label, key in (
        (columns[2], "Average response time", "mean_response_time"),
        (columns[3], "p95 response time", "p95_response_time"),
    ):
        value = summary[key]
        column.metric(label, "N/A" if value is None else f"{value:.3f} s")

    if summary["completed_count"] == 0:
        st.info("No completed requests. Response times are unavailable.")
    st.caption("Response time includes waiting and service time, in simulated seconds.")
    st.subheader("Per-server utilization")
    utilization = summary["per_server_utilization"]
    if utilization:
        st.table([
            {"Server ID": server_id, "Slot utilization (%)": round(fraction * 100, 2)}
            for server_id, fraction in sorted(utilization.items())
        ])
    else:
        st.info("No server utilization data available.")
    st.caption("Modeled slot occupancy during the arrival window; draining time is excluded. "
               "This does not measure CPU usage.")
