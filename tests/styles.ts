import { StyleSheet } from "react-native";

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  row: {
    flex: 1,
    flexDirection: 'row',
    paddingLeft: 10,
    paddingRight: 10,
  },
  cell: {
    flex: 1,
    textAlignVertical: 'center',
  },
  header_row: {
    backgroundColor: '#999999',
    maxHeight: 50,
  },
  header_cell: {
    fontWeight: 'bold',
  },
  content_row: {
  },
  content_cell: {
  },
  pending: {
    backgroundColor: 'blue',
  },
  processing: {
    backgroundColor: 'orange',
  },
  success: {
    backgroundColor: 'green',
  },
  failure: {
    backgroundColor: 'red',
  },
  label_cell: {
    flex: 3,
  },
  result_cell: {
    flex: 3,
  },
  duration_cell: {
    flex: 1,
    textAlign: 'right'
  },
  suite_title: {
    fontWeight: 'bold',
    fontSize: 26,
    backgroundColor: '#ccccff',
    paddingLeft: 10,
    paddingRight: 10,
  },
  suite_summary: {
    backgroundColor: '#ccccff',
    marginBottom: 20,
  },
  suite_summary_text: {
    paddingLeft: 10,
    paddingRight: 10,
  },
});

export default styles;