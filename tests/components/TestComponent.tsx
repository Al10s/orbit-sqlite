import React from 'react';
import { RunnableTest } from '../utils';
import { View, Text } from 'react-native';
import styles from '../styles';
import moment from 'moment';

export interface Props {
  test: RunnableTest;
}

type Status = 'pending'|'processing'|'done'|'failed';

interface State {
  status: Status;
  result: string;
  duration: string;
}

export default class TestComponent extends React.Component<Props, State> {
  constructor (props: Props) {
    super(props);
    this.state = {
      status: 'pending',
      result: '',
      duration: '',
    };
  }

  componentDidMount () {
    this.setState({ status: 'processing' });
    const start = moment();
    this.props.test.run()
      .then(() => {
        this.props.test.emitter.trigger('done');
        this.setState({ status: 'done', result: 'PASSED' })
      })
      .catch((error: Error) => {
        this.props.test.emitter.trigger('failed', { error });
        this.setState({ status: 'failed', result: error.message });
      })
      .finally(() => {
        const duration = moment().diff(start);
        const format = duration > 60 * 1000 ? 'm:ss:SSS' : 's.SSS';
        this.setState({ 'duration': moment.utc(duration).format(format) })
      });
  }

  render = () => {
    const rowStyle = (this.state.status === 'pending' ? styles.pending :
      (this.state.status === 'processing' ? styles.processing :
        (this.state.status === 'done' ? styles.done :
          styles.failed
        )
      )
    );
    return (
      <View
        style={{
          ...styles.row,
          ...styles.content_row,
          ...rowStyle
        }}
        >
        <Text style={{ ...styles.cell, ...styles.content_cell, ...styles.label_cell }}>{this.props.test.label}</Text>
        <Text style={{ ...styles.cell, ...styles.content_cell, ...styles.result_cell }}>{this.state.result}</Text>
        <Text style={{ ...styles.cell, ...styles.content_cell, ...styles.duration_cell }}>{this.state.duration}</Text>
      </View>
    );
  }
}