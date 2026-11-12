"""Read-only side-by-side display of two validated saved result sets."""

import streamlit as st

from lbsim.exports import CONFIG_FIELDS
from lbsim.saved_runs import load_results


def display_comparison(left, right):
    changed = [field for field in CONFIG_FIELDS if left.config[field] != right.config[field]]
    if any(field != "policy" for field in changed):
        st.warning("Settings differ: " + ", ".join(changed) +
                   ". Workload or capacity differences also affect these results; "
                   "this is not an isolated policy comparison.")
    elif changed:
        st.info("Only the routing policy differs; workload and capacity settings match.")
    else:
        st.info("Both files have the same configuration.")
    for label, column, saved in zip(("Run A", "Run B"), st.columns(2), (left, right)):
        with column:
            st.subheader(label)
            st.write(f"**Policy:** {saved.config['policy']}")
            st.caption(f"Run ID: {saved.run_id}")
            summary = saved.summary
            total = summary["completed_count"] + summary["rejected_count"]
            st.caption(f"{total:,} generated · {summary['completed_count']:,} completed · "
                       f"{summary['rejected_count']:,} rejected")
            for title, field in (("Average response time", "mean_response_time"),
                                 ("p95 response time", "p95_response_time")):
                value = summary[field]
                st.metric(title, "N/A" if value is None else f"{value:.3f} s")
            st.metric("Rejection rate", "N/A" if total == 0 else
                      f"{summary['rejected_count'] / total:.1%}")
            utilization = summary["per_server_utilization"]
            st.metric("Mean server slot utilization",
                      f"{sum(utilization.values()) / len(utilization):.1%}")
            st.dataframe([{"Server ID": sid, "Slot utilization (%)": value * 100}
                          for sid, value in sorted(utilization.items())], hide_index=True)
    st.caption("Latency includes waiting and draining, for completed requests only. "
               "Utilization excludes draining beyond the arrival window. "
               "Mean utilization averages all servers in each run. No completions: "
               "N/A latency; no generated requests: N/A rejection rate.")
    st.table([{"Setting": field, "Run A": str(left.config[field]),
               "Run B": str(right.config[field])} for field in CONFIG_FIELDS])


def display_saved_comparison():
    with st.expander("Compare saved results"):
        st.caption("Upload two original results CSV exports. Comparison reads their "
                   "saved metrics and does not run a simulation or change the active run.")
        saved_runs = []
        for label, column, key in zip(("Run A results (CSV)", "Run B results (CSV)"),
                                      st.columns(2), ("compare_a", "compare_b")):
            with column:
                upload = st.file_uploader(label, type=["csv"], key=key)
                saved = None
                if upload is not None:
                    try:
                        saved = load_results(upload.getvalue())
                    except ValueError as error:
                        st.error(f"{label}: {error}")
                saved_runs.append(saved)
        if all(saved is not None for saved in saved_runs):
            display_comparison(*saved_runs)
        else:
            st.info("Choose two valid results CSV files to compare.")
