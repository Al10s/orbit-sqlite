import React from 'react';
import { RunnableTest } from '../utils';
import { View, Text } from 'react-native';
import styles from '../styles';

export interface Props {
  test: RunnableTest;
}

type Status = 'pending'|'processing'|'done'|'failed';

interface State {
  status: Status;
  result: string;
}

export default class TestComponent extends React.Component<Props, State> {
  constructor (props: Props) {
    super(props);
    this.state = {
      status: 'pending',
      result: '',
    };
  }

  componentDidMount () {
    this.setState({ status: 'processing' });
    this.props.test.run()
      .then(() => {
        this.props.test.emitter.trigger('done');
        this.setState({ status: 'done', result: 'PASSED' })
      })
      .catch((error: Error) => {
        this.props.test.emitter.trigger('failed', { error });
        this.setState({ status: 'failed', result: error.message });
      });
  }

  render = () => {
    return (
      <View
        style={{
          ...styles.row,
          ...styles.content_row,
          ...(this.state.status === 'pending' ? styles.pending :
            (this.state.status === 'processing' ? styles.processing :
              (this.state.status === 'done' ? styles.done :
                styles.failed
              )
            )
          )
        }}
        >
        <Text style={{ ...styles.cell, ...styles.content_cell }}>{this.props.test.label}</Text>
        <Text style={{ ...styles.cell, ...styles.content_cell }}>{this.state.result}</Text>
      </View>
    );
  }
}