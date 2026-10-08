"""Display actual run metrics and accessible chart data in Streamlit."""

import streamlit as st
from lbsim.datacenter import display_datacenter

TEAL = '#147D92'
ORANGE = '#B85A27'


def chart(spec: dict, height: int = 240, alt: str = "Simulation results chart"):
    st.vega_lite_chart(spec={
        'height': height,
        'config': {'view': {'stroke': None}, 'axis': {'labelFontSize': 12, 'titleFontSize': 12}},
        **spec,
    }, width="stretch", alt=alt)


def display_summary(summary: dict, config: dict | None = None):
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
    st.caption("Response times include queue waiting and service, in simulated seconds.")
    overview, datacenter, details = st.tabs(['Overview', 'Datacenter', 'Server details'])
    with overview:
        outcomes, latency = st.columns(2)
        with outcomes:
            st.subheader('Request outcomes')
            counts = [{'Outcome': 'Completed', 'Requests': summary['completed_count']},
                      {'Outcome': 'Rejected', 'Requests': summary['rejected_count']}]
            total = sum(row['Requests'] for row in counts)
            if total:
                chart({'data': {'values': counts}, 'mark': {'type': 'bar', 'cornerRadiusEnd': 3},
                       'encoding': {
                           'y': {'field': 'Outcome', 'type': 'nominal', 'title': None, 'sort': ['Completed', 'Rejected']},
                           'x': {'field': 'Requests', 'type': 'quantitative', 'axis': {'tickMinStep': 1}},
                           'color': {'field': 'Outcome', 'type': 'nominal', 'legend': None,
                                     'scale': {'domain': ['Completed', 'Rejected'], 'range': [TEAL, ORANGE]}},
                           'tooltip': [{'field': 'Outcome'}, {'field': 'Requests'}],
                       }}, alt='Completed and rejected request counts')
                st.caption(f"{summary['rejected_count'] / total:.1%} rejected out of {total:,} requests.")
            else:
                st.caption('No requests were generated. Increase the rate or arrival window.')
        with latency:
            st.subheader('Response time distribution')
            times = summary.get('response_times', [])
            if times:
                chart({'data': {'values': [{'Seconds': t} for t in times]}, 'layer': [
                    {'mark': {'type': 'bar', 'color': TEAL}, 'encoding': {
                        'x': {'field': 'Seconds', 'type': 'quantitative', 'bin': {'maxbins': 20},
                              'title': 'Response time (s)'},
                        'y': {'aggregate': 'count', 'type': 'quantitative', 'title': 'Completed requests',
                              'axis': {'tickMinStep': 1}},
                        'tooltip': [{'field': 'Seconds', 'bin': {'maxbins': 20}, 'type': 'quantitative', 'title': 'Seconds'},
                                    {'aggregate': 'count', 'type': 'quantitative', 'title': 'Requests'}],
                    }},
                    {'data': {'values': [{'p95': summary['p95_response_time']}]},
                     'mark': {'type': 'rule', 'color': ORANGE, 'strokeDash': [5, 4]},
                     'encoding': {'x': {'field': 'p95', 'type': 'quantitative'},
                                  'tooltip': [{'field': 'p95', 'type': 'quantitative', 'format': '.3f'}]}},
                ]}, alt='Histogram of completed-request response times with a p95 reference line')
                st.caption('Each bar groups similar response times. The dashed line marks p95.')
            else:
                st.caption('Run a simulation with completed requests to see the distribution.')

        st.subheader('Per-server utilization')
        utilization = summary['per_server_utilization']
        rows = [{'Server ID': i, 'Slot utilization (%)': round(fraction * 100, 2)}
                for i, fraction in sorted(utilization.items())]
        if rows:
            chart({'data': {'values': rows},
                   'mark': {'type': 'bar' if len(rows) <= 40 else 'line', 'color': TEAL},
                   'encoding': {
                       'x': {'field': 'Server ID', 'type': 'ordinal' if len(rows) <= 40 else 'quantitative',
                             'axis': {'labelAngle': 0, 'tickCount': 10, 'tickMinStep': 1}},
                       'y': {'field': 'Slot utilization (%)', 'type': 'quantitative', 'scale': {'domain': [0, 100]}},
                       'tooltip': [{'field': 'Server ID'}, {'field': 'Slot utilization (%)', 'format': '.2f'}],
                   }}, height=200, alt='Occupied slot percentage for each server during the arrival window')
        else:
            st.info('No server utilization data available.')
        st.caption('Occupied slots during the arrival window. Draining time is excluded; this is modeled utilization.')
    with datacenter:
        display_datacenter(summary['per_server_utilization'], config, summary.get('events', []))
    with details:
        st.caption('Values behind the utilization chart.')
        st.table(rows)
